/**
 * 모임 라우트.
 *
 * 모임이 최상위 단위다 — 멤버·일정·폴더·정산·문서가 모임 단위로 완전히 분리된다.
 * 그래서 여기 있는 모든 라우트는 "이 사람이 이 모임의 안 나간 멤버인가"를 먼저 묻는다.
 *
 * ⚠ 멤버를 지울 때 행을 삭제하지 않는다. 정산에서 빠지면 잔액 합이 0이 되지 않는다.
 */

import { daysBetween, dowOf, formatWon, isCurrency, parseDate } from "@tripmate/core";
import type { FastifyInstance } from "fastify";
import type { Updateable } from "kysely";
import { z } from "zod";
import { allMembers, requireMember, requireOwner } from "../auth/membership.ts";
import { requireAuth } from "../auth/session.ts";
import { db } from "../db/client.ts";
import type { GroupsTable } from "../db/types.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/http.ts";
import { createGroup, groupOrThrow, renameGroup, syncDays } from "../services/groups.ts";
import { loadSettlement } from "../services/settlement.ts";

/** YYYY-MM-DD 이고 실제로 존재하는 날짜인가. parseDate 가 2026-02-30 같은 것도 잡는다. */
const isoDate = z.string().refine(
  (v) => {
    try {
      parseDate(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: "날짜는 YYYY-MM-DD 형식이어야 합니다" },
);

const nameField = z.string().trim().min(1, "모임 이름을 입력하세요").max(40);
const destField = z.string().trim().max(40);
const memoField = z.string().trim().max(500);

const createBody = z
  .object({
    name: nameField,
    dest: destField.default(""),
    start: isoDate,
    end: isoDate,
    memo: memoField.default(""),
  })
  .refine((v) => v.end >= v.start, { message: "종료일이 시작일보다 빠릅니다", path: ["end"] })
  // buildDays 가 여기서 막지 않으면 raw Error 로 터져 500 이 된다. 400 으로 돌려주는 게 맞다.
  .refine((v) => daysBetween(v.start, v.end) <= 364, {
    message: "여행 기간은 365일을 넘을 수 없습니다",
    path: ["end"],
  });

const patchBody = z.object({
  name: nameField.optional(),
  dest: destField.optional(),
  start: isoDate.optional(),
  end: isoDate.optional(),
  memo: memoField.optional(),
  cur: z.string().trim().toUpperCase().refine(isCurrency, "지원하지 않는 통화입니다").optional(),
});

const gidParam = z.object({ gid: z.string().uuid() });
const memberParam = z.object({ gid: z.string().uuid(), mid: z.string().uuid() });

type GroupRow = Awaited<ReturnType<typeof groupOrThrow>>;

/** 상세·수정 응답의 group 은 항상 같은 모양으로 내보낸다. 화면마다 필드가 다르면 캐시가 꼬인다. */
function serializeGroup(g: GroupRow) {
  return {
    id: g.id,
    name: g.name,
    dest: g.dest,
    start: g.start_date,
    end: g.end_date,
    memo: g.memo,
    cur: g.cur,
    ownerId: g.owner_id,
    // drive_folder_id 는 내보내지 않는다. 화면이 쓰지 않고, 저장소 식별자를 브라우저에
    // 흘려 둘 이유가 없다. 폴더 응답(modules/folders.ts)도 같은 이유로 뺀다.
    settleClosedAt: g.settle_closed_at,
    createdAt: g.created_at,
  };
}

type MemberRow = Awaited<ReturnType<typeof allMembers>>[number];

function serializeMember(m: MemberRow) {
  return {
    id: m.id,
    userId: m.user_id,
    name: m.name,
    colorBg: m.color_bg,
    colorFg: m.color_fg,
    // 카카오 프로필 사진. 없으면 화면이 이름 첫 글자로 떨어진다.
    // 멤버 전용 라우트에서만 나간다 — 뷰어·정산 공유에는 이 함수가 쓰이지 않는다.
    avatarUrl: m.avatar_url,
    role: m.role,
    left: m.left_at !== null, // 나갔지만 정산에는 그대로 남아 있다
    joinedAt: m.joined_at,
  };
}

/** 안 나간 멤버 수. 모임 스위처와 초대 화면이 쓰는 숫자다. */
async function activeMemberCounts(groupIds: string[]): Promise<Map<string, number>> {
  if (!groupIds.length) return new Map();
  const rows = await db
    .selectFrom("members")
    .select(["group_id", (eb) => eb.fn.countAll<string>().as("c")])
    .where("group_id", "in", groupIds)
    .where("left_at", "is", null)
    .groupBy("group_id")
    .execute();
  return new Map(rows.map((r) => [r.group_id, Number(r.c)]));
}

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  // ── 목록 ──────────────────────────────────────────────────────────
  // 사이드바 하단 스위처가 쓴다. 나간 모임과 삭제된 모임은 보이지 않는다.
  app.get("/api/groups", async (req) => {
    const user = await requireAuth(req);

    const rows = await db
      .selectFrom("members")
      .innerJoin("groups", "groups.id", "members.group_id")
      .select([
        "groups.id as id",
        "groups.name as name",
        "groups.dest as dest",
        "groups.start_date as start",
        "groups.end_date as end",
        "groups.cur as cur",
        "members.role as role",
      ])
      .where("members.user_id", "=", user.id)
      .where("members.left_at", "is", null)
      .where("groups.deleted_at", "is", null)
      .orderBy("groups.start_date", "desc")
      .orderBy("groups.created_at", "desc")
      .execute();

    const counts = await activeMemberCounts(rows.map((r) => r.id));
    return {
      groups: rows.map((r) => ({ ...r, memberCount: counts.get(r.id) ?? 0 })),
    };
  });

  // ── 생성 ──────────────────────────────────────────────────────────
  // 일차·루트 폴더·방장 멤버·정산 토큰이 services/groups.ts 안에서 함께 생긴다.
  app.post("/api/groups", async (req, reply) => {
    const user = await requireAuth(req);
    const body = createBody.safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");

    const id = await createGroup({
      name: body.data.name,
      dest: body.data.dest,
      start: body.data.start,
      end: body.data.end,
      memo: body.data.memo,
      ownerId: user.id,
      ownerName: user.name,
    });
    return reply.status(201).send({ id });
  });

  // ── 상세 ──────────────────────────────────────────────────────────
  app.get("/api/groups/:gid", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    const me = await requireMember(user, gid);

    const group = await groupOrThrow(gid);
    const days = await db
      .selectFrom("days")
      .select(["id", "n", "date", "label"])
      .where("group_id", "=", gid)
      .orderBy("n", "asc")
      .execute();
    const members = await allMembers(gid);

    return {
      group: serializeGroup(group),
      // 요일은 저장하지 않고 날짜에서 만든다 — 두 벌로 두면 어긋난다
      days: days.map((d) => ({ id: d.id, n: d.n, date: d.date, dow: dowOf(d.date), label: d.label })),
      members: members.map(serializeMember),
      me: { memberId: me.memberId, role: me.role },
    };
  });

  // ── 수정 ──────────────────────────────────────────────────────────
  app.patch("/api/groups/:gid", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    await requireOwner(user, gid);

    const body = patchBody.safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");
    const p = body.data;

    const before = await groupOrThrow(gid);
    const start = p.start ?? before.start_date;
    const end = p.end ?? before.end_date;
    if (end < start) throw badRequest("종료일이 시작일보다 빠릅니다");
    if (daysBetween(start, end) > 364) throw badRequest("여행 기간은 365일을 넘을 수 없습니다");

    // 기간이 바뀌면 일차를 먼저 맞춘다. 빠지는 날에 일정이 남아 있으면 409 로 멈추고,
    // 그때 groups 행은 아직 손대지 않은 상태여야 화면과 DB 가 어긋나지 않는다.
    if (start !== before.start_date || end !== before.end_date) {
      await syncDays(gid, start, end);
    }

    // 이름은 Drive 루트 폴더 이름과 항상 같은 값이다. 한쪽만 바꾸는 코드를 두지 않는다.
    if (p.name !== undefined && p.name !== before.name) {
      await renameGroup(gid, p.name);
    }

    const patch: Updateable<GroupsTable> = { updated_at: new Date() };
    if (p.dest !== undefined) patch.dest = p.dest;
    if (p.memo !== undefined) patch.memo = p.memo;
    if (start !== before.start_date) patch.start_date = start;
    if (end !== before.end_date) patch.end_date = end;
    // 여행지를 바꿔도 기본 통화를 다시 추론하지 않는다.
    // cur 은 새 항목의 기본값일 뿐이지만, 조용히 바뀌면 이후 입력이 다른 통화로 저장돼
    // 이미 정산된 금액과 섞인다. 명시적으로 cur 을 보낼 때만 바꾼다.
    if (p.cur !== undefined) patch.cur = p.cur;

    await db.updateTable("groups").set(patch).where("id", "=", gid).execute();
    return { group: serializeGroup(await groupOrThrow(gid)) };
  });

  // ── 삭제 ──────────────────────────────────────────────────────────
  // 소프트 삭제. Drive 폴더는 건드리지 않는다 — 사진 유실이 가장 비싼 사고다.
  app.delete("/api/groups/:gid", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    await requireOwner(user, gid);

    await db
      .updateTable("groups")
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where("id", "=", gid)
      .execute();
    return { ok: true };
  });

  // ── 멤버 목록 ─────────────────────────────────────────────────────
  // 나간 멤버도 함께 준다. 정산 화면이 "기타(나감)"으로 그려야 하기 때문이다.
  app.get("/api/groups/:gid/members", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    await requireMember(user, gid);

    const members = await allMembers(gid);
    return { members: members.map(serializeMember) };
  });

  // ── 방장 위임 ─────────────────────────────────────────────────────
  app.patch("/api/groups/:gid/members/:mid", async (req) => {
    const user = await requireAuth(req);
    const { gid, mid } = memberParam.parse(req.params);
    const me = await requireOwner(user, gid);

    const body = z.object({ role: z.literal("owner") }).safeParse(req.body ?? {});
    if (!body.success) throw badRequest("방장 위임(role:\"owner\") 외에는 바꿀 수 없습니다");

    const target = await db
      .selectFrom("members")
      .select(["id", "user_id", "role", "left_at"])
      .where("id", "=", mid)
      .where("group_id", "=", gid)
      .executeTakeFirst();
    if (!target) throw notFound("멤버를 찾을 수 없습니다");
    if (target.left_at) throw conflict("이미 나간 멤버에게는 위임할 수 없습니다");
    if (target.id === me.memberId) return { ok: true }; // 이미 방장이다

    // members.role 과 groups.owner_id 가 어긋나면 권한 판정이 갈린다. 한 트랜잭션에서 같이 바꾼다.
    await db.transaction().execute(async (trx) => {
      await trx.updateTable("members").set({ role: "member" }).where("id", "=", me.memberId).execute();
      await trx.updateTable("members").set({ role: "owner" }).where("id", "=", target.id).execute();
      await trx
        .updateTable("groups")
        .set({ owner_id: target.user_id, updated_at: new Date() })
        .where("id", "=", gid)
        .execute();
    });
    return { ok: true };
  });

  // ── 나가기 / 내보내기 ─────────────────────────────────────────────
  // ⚠ 행을 지우지 않고 left_at 만 찍는다. 이미 낸 돈과 낼 돈이 정산에 남아 있다.
  app.delete("/api/groups/:gid/members/:mid", async (req) => {
    const user = await requireAuth(req);
    const { gid, mid } = memberParam.parse(req.params);
    const me = await requireMember(user, gid);

    const target = await db
      .selectFrom("members")
      .select(["id", "role", "left_at"])
      .where("id", "=", mid)
      .where("group_id", "=", gid)
      .executeTakeFirst();
    if (!target) throw notFound("멤버를 찾을 수 없습니다");
    if (target.left_at) throw conflict("이미 나간 멤버입니다");

    const isSelf = target.id === me.memberId;
    if (!isSelf && !me.isOwner) throw forbidden("방장만 다른 멤버를 내보낼 수 있습니다");

    if (isSelf && me.isOwner) {
      // 방장이 그냥 나가면 주인 없는 모임이 남는다. 위임을 강제한다.
      const others = await db
        .selectFrom("members")
        .select("id")
        .where("group_id", "=", gid)
        .where("left_at", "is", null)
        .where("id", "!=", me.memberId)
        .execute();
      throw conflict(
        others.length
          ? "방장을 다른 멤버에게 위임한 뒤에 나갈 수 있습니다"
          : "혼자 남은 방장은 나갈 수 없습니다. 모임을 삭제하세요.",
        { needsDelegate: others.length > 0 },
      );
    }

    await db.updateTable("members").set({ left_at: new Date() }).where("id", "=", target.id).execute();
    return { ok: true };
  });

  // ── 나가기 전 안내 ────────────────────────────────────────────────
  // 미정산 잔액이 있어도 막지 않는다 — 정산에는 그대로 남으므로 데이터가 깨지지 않는다.
  // (판단 근거: docs/decisions/2026-08-17-implementation-choices.md A항)
  app.get("/api/groups/:gid/leave-check", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    const me = await requireMember(user, gid);

    const result = await loadSettlement(gid);
    const net = result.balance.find((b) => b.id === me.memberId)?.net ?? 0;

    const message =
      net > 0
        ? `아직 받을 돈 ${formatWon(net)} 이 남아 있습니다. 나가도 정산 목록에는 그대로 남습니다.`
        : net < 0
          ? `아직 보낼 돈 ${formatWon(-net)} 이 남아 있습니다. 나가도 정산 목록에는 그대로 남습니다.`
          : "정산이 끝났습니다. 지금 나가도 남는 금액이 없습니다.";

    return { net, warn: net !== 0, message };
  });
}
