/**
 * ══════════ 정산 라우트 ══════════
 *
 * 계산은 하지 않는다. @tripmate/core 의 settle() 이 정본이고
 * services/settlement.ts 의 loadSettlement() 이 DB → core 를 이어 준다.
 * 여기서 하는 일은 셋뿐이다:
 *   1. 계산 결과를 화면이 쓰는 모양으로 줄여서 내보낸다
 *   2. "지금 로그인한 사람이 누를 수 있는 버튼"(canAct)을 서버가 판정한다
 *   3. 사람이 누른 단계(대기 → req → done)를 저장한다
 *
 * ⚠ "1인당 평균" 같은 전원 균등 가정 숫자를 만들지 않는다.
 *   정산 대상은 항목마다 다르므로 아무도 실제로 부담하지 않는 금액이고, 오해만 만든다.
 *   대신 로그인한 사람의 owed 를 myOwed 로 보낸다.
 *
 * ⚠ 입금 여부를 시스템이 판단하지 않는다. 상태 전이는 전부 사람이 누른다.
 */

import { randomToken, settleSharePath, type SettleItemComputed, type SettleResult } from "@tripmate/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember, requireOwner } from "../auth/membership.ts";
import { requireAuth } from "../auth/session.ts";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/http.ts";
import { loadSettlement, syncClosed } from "../services/settlement.ts";

const uuid = z.string().uuid();

/** 라우트 파라미터 검증. uuid 가 아니면 DB 까지 가기 전에 400 으로 끊는다. */
function parseUuid(v: unknown, what: string): string {
  const r = uuid.safeParse(v);
  if (!r.success) throw badRequest(`${what} 형식이 올바르지 않습니다`);
  return r.data;
}

/**
 * 안내용으로 줄인 항목.
 * 결제자 미지정 · 대상 없음 · 정산 제외 · 외화 항목은 화면에서 **따로** 안내되어야 하므로
 * 네 목록을 합치지 않고 그대로 각각 내보낸다.
 */
const slim = (i: SettleItemComputed) => ({
  id: i.id,
  title: i.title,
  dayN: i.dayN,
  date: i.date,
  cat: i.cat,
  cost: i.cost,
  cur: i.cur,
  krw: i.krw,
  payerId: i.payer,
});

/**
 * 이체 한 줄에서 "내가 지금 누를 수 있는 버튼"을 정한다.
 *   대기(null) 이고 내가 보낸 사람  → 송금 확인 요청("req")
 *   요청("req") 이고 내가 받는 사람 → 정산 완료("done")
 * 그 외에는 null — 프론트는 이 값만 보고 버튼을 켠다.
 */
function transferCanAct(
  state: "req" | "done" | null,
  fromId: string,
  toId: string,
  me: string,
): "req" | "done" | null {
  if (state === null && fromId === me) return "req";
  if (state === "req" && toId === me) return "done";
  return null;
}

/** GET 과 PUT 이 똑같은 응답을 돌려주도록 한 곳에서 만든다 (프론트가 재요청하지 않게 한다). */
async function settlementResponse(groupId: string, meMemberId: string) {
  const r: SettleResult = await loadSettlement(groupId);
  const closedAt = await syncClosed(groupId, r);

  return {
    total: r.total,
    guestTotal: r.guestTotal,
    /** 로그인한 사람이 실제로 낼 돈. 전원 균등 가정 숫자가 아니다 */
    myOwed: r.balance.find((b) => b.id === meMemberId)?.owed ?? 0,
    closed: r.closed,
    closedAt: closedAt ? closedAt.toISOString() : null,
    doneCount: r.doneCount,
    totalSteps: r.totalSteps,

    // spent(실제 결제액)와 paid(정산 반영액)는 뜻이 다르다. 이름을 섞지 않는다.
    balance: r.balance.map((b) => ({
      id: b.id,
      name: b.name,
      left: b.left,
      spent: b.spent,
      paid: b.paid,
      owed: b.owed,
      net: b.net,
    })),

    transfers: r.transfers.map((t) => ({
      fromId: t.fromId,
      fromName: t.fromName,
      toId: t.toId,
      toName: t.toName,
      amt: t.amt,
      state: t.state,
      canAct: transferCanAct(t.state, t.fromId, t.toId, meMemberId),
    })),

    // 기타 인원 몫은 앱이 청구할 대상이 없다. 결제자 본인이 "받음 확인"을 누른다.
    collectors: r.collectors.map((c) => ({
      id: c.id,
      name: c.name,
      amt: c.amt,
      received: c.received,
      canAct: c.id === meMemberId && !c.received,
    })),

    pending: r.pending.map(slim),
    noTarget: r.noTarget.map(slim),
    excluded: r.excluded.map(slim),
    fxItems: r.fxItems.map(slim),
  };
}

const transferBody = z.object({ state: z.enum(["req", "done"]).nullable() });
const guestBackBody = z.object({ received: z.boolean() });

export async function settlementRoutes(app: FastifyInstance): Promise<void> {
  // ── 전체 계산 결과 ────────────────────────────────────────────────
  app.get("/api/groups/:gid/settlement", async (req) => {
    const user = await requireAuth(req);
    const gid = parseUuid((req.params as { gid: string }).gid, "모임 id");
    const me = await requireMember(user, gid);
    return settlementResponse(gid, me.memberId);
  });

  // ── 이체 한 건의 단계 넘기기 ──────────────────────────────────────
  // 대기 → (보낸 사람) 송금 확인 요청 → (받는 사람) 정산 완료.
  // 시스템은 입금을 확인하지 않는다. 누가 누를 수 있는지만 강제한다.
  app.put("/api/groups/:gid/settlement/transfers/:from/:to", async (req) => {
    const user = await requireAuth(req);
    const p = req.params as { gid: string; from: string; to: string };
    const gid = parseUuid(p.gid, "모임 id");
    const from = parseUuid(p.from, "보낸 사람 id");
    const to = parseUuid(p.to, "받는 사람 id");
    const me = await requireMember(user, gid);

    const parsed = transferBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('state 는 "req" | "done" | null 이어야 합니다');
    const next = parsed.data.state;

    // 지금 계산 결과에 실제로 있는 이체인가.
    // 금액이 바뀌면 이체 목록 자체가 달라지므로, 없는 쌍이면 화면이 낡은 것이다.
    const before = await loadSettlement(gid);
    const t = before.transfers.find((x) => x.fromId === from && x.toId === to);
    if (!t) {
      throw conflict("정산 내역이 바뀌어 그 이체가 더 이상 없습니다. 화면을 새로고침하세요");
    }
    const cur = t.state;

    // 권한과 상태 전이를 서버에서 강제한다.
    // "done" 을 대기(null) 상태에서도 허용하는 이유:
    //   받는 사람이 이미 계좌로 돈을 받았는데 보낸 사람이 "송금 확인 요청"을 안 눌렀을 수 있다.
    //   그때 받은 사람이 완료를 못 누르면 정산이 영원히 마감되지 않는다.
    let allowed: boolean;
    if (next === "req") {
      allowed = me.memberId === from && cur === null;
    } else if (next === "done") {
      allowed = me.memberId === to && (cur === "req" || cur === null);
    } else if (cur === "req") {
      allowed = me.memberId === from; // 요청을 만든 쪽만 취소한다
    } else if (cur === "done") {
      allowed = me.memberId === to; // 완료를 누른 쪽만 되돌린다
    } else {
      allowed = me.memberId === from || me.memberId === to; // 이미 대기 — 변화 없음
    }
    if (!allowed) throw forbidden("이 이체에 대해 지금 누를 수 있는 단계가 아닙니다");

    if (next === null) {
      await db
        .deleteFrom("transfer_states")
        .where("group_id", "=", gid)
        .where("from_id", "=", from)
        .where("to_id", "=", to)
        .execute();
    } else {
      await db
        .insertInto("transfer_states")
        // 지금 화면에 떠 있는 금액을 함께 박아 둔다. 나중에 항목이 바뀌어 이체액이
        // 달라지면 settle() 이 이 금액과 대조해 확인을 버리고, 마감이 자동으로 풀린다.
        .values({
          group_id: gid,
          from_id: from,
          to_id: to,
          state: next,
          amt: t.amt,
          updated_by: user.id,
        })
        .onConflict((oc) =>
          oc
            .columns(["group_id", "from_id", "to_id"])
            .doUpdateSet({ state: next, amt: t.amt, updated_at: new Date(), updated_by: user.id }),
        )
        .execute();
    }

    // 저장 후 전체를 다시 계산해 돌려준다 — 프론트가 다시 GET 하지 않게 한다.
    return settlementResponse(gid, me.memberId);
  });

  // ── 기타 인원 몫 "받음 확인" ──────────────────────────────────────
  // 모임 밖 인원은 앱이 청구할 대상이 없다. 결제자가 직접 받고 본인이 확인한다.
  app.put("/api/groups/:gid/settlement/guest-back/:mid", async (req) => {
    const user = await requireAuth(req);
    const p = req.params as { gid: string; mid: string };
    const gid = parseUuid(p.gid, "모임 id");
    const mid = parseUuid(p.mid, "멤버 id");
    const me = await requireMember(user, gid);

    const parsed = guestBackBody.safeParse(req.body);
    if (!parsed.success) throw badRequest("received 는 boolean 이어야 합니다");
    const received = parsed.data.received;

    // 남이 대신 눌러 줄 수 없다. 돈을 실제로 받는 사람만 안다.
    if (me.memberId !== mid) throw forbidden("기타 인원 몫은 결제자 본인만 확인할 수 있습니다");

    if (received) {
      const before = await loadSettlement(gid);
      const collector = before.collectors.find((c) => c.id === mid);
      if (!collector) {
        throw conflict("받을 기타 인원 몫이 없습니다. 화면을 새로고침하세요");
      }
      await db
        .insertInto("guest_back_states")
        // 이체와 같은 이유로 금액을 함께 저장한다 — 몫이 달라지면 확인이 무효가 된다.
        .values({
          group_id: gid,
          member_id: mid,
          received: true,
          amt: collector.amt,
          updated_by: user.id,
        })
        .onConflict((oc) =>
          oc.columns(["group_id", "member_id"]).doUpdateSet({
            received: true,
            amt: collector.amt,
            updated_at: new Date(),
            updated_by: user.id,
          }),
        )
        .execute();
    } else {
      // 행이 없는 것과 received=false 는 같은 뜻이다. 되돌릴 때는 지운다.
      await db
        .deleteFrom("guest_back_states")
        .where("group_id", "=", gid)
        .where("member_id", "=", mid)
        .execute();
    }

    return settlementResponse(gid, me.memberId);
  });

  // ── 정산 공유 링크 ────────────────────────────────────────────────
  // 문서·사진·일정으로 넘어갈 수 없는, 정산만 보는 링크 하나다.
  app.get("/api/groups/:gid/settlement/share", async (req) => {
    const user = await requireAuth(req);
    const gid = parseUuid((req.params as { gid: string }).gid, "모임 id");
    await requireMember(user, gid);

    const g = await db
      .selectFrom("groups")
      .select("settle_token")
      .where("id", "=", gid)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!g) throw notFound("모임을 찾을 수 없습니다");

    return { url: env.APP_ORIGIN + settleSharePath(gid, g.settle_token), token: g.settle_token };
  });

  // 재발급하면 이전 링크는 즉시 죽는다 — 예전에 뿌린 주소가 되살아나면 안 된다.
  app.post("/api/groups/:gid/settlement/share/rotate", async (req) => {
    const user = await requireAuth(req);
    const gid = parseUuid((req.params as { gid: string }).gid, "모임 id");
    await requireOwner(user, gid);

    const token = randomToken();
    const updated = await db
      .updateTable("groups")
      .set({ settle_token: token, updated_at: new Date() })
      .where("id", "=", gid)
      .where("deleted_at", "is", null)
      .returning("settle_token")
      .executeTakeFirst();
    if (!updated) throw notFound("모임을 찾을 수 없습니다");

    return { url: env.APP_ORIGIN + settleSharePath(gid, token), token };
  });
}
