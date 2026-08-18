/**
 * ══════════ 공개 뷰어 (로그인 불필요) ══════════
 *
 * 이 파일이 가장 조심해야 하는 곳이다. 밖으로 나가는 것을 여기서 통제한다.
 *
 * 규칙 (CLAUDE.md 확정):
 *  · 외부로 나가는 것은 **미디어(사진·동영상)뿐이다.** 문서와 일정은 어떤 경우에도 넣지 않는다.
 *    유일한 예외가 정산 공유 링크이고, 그것도 이름·금액·이체 목록까지다.
 *  · **Drive 파일 링크나 서명 URL 을 절대 노출하지 않는다.**
 *    사진 주소는 언제나 `/api/media/:id?t=<token>` — 서버가 받아서 전달한다.
 *  · 뷰어는 **그 폴더의 미디어만** 본다. 하위 폴더 목록도, 형제 폴더도, 부모 경로도 주지 않는다.
 *  · 토큰이 어긋나면 404 다. 403 을 주면 "그 폴더가 있긴 하다"를 알려주는 셈이다.
 *  · 멤버 id 를 밖으로 내보내지 않는다. 이름과 금액만 나간다.
 */

import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/client.ts";
import { badRequest, notFound } from "../lib/http.ts";
import { loadSettlement } from "../services/settlement.ts";

const uuid = z.string().uuid();

/** 모임 id 가 uuid 가 아니면 DB 까지 가지 않고 404 로 끊는다 (존재 여부를 알려주지 않는다). */
function viewerGroupId(v: unknown): string {
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound("링크가 올바르지 않습니다");
  return r.data;
}

/** 정렬 기준. 기본은 업로드순이고 촬영순을 고를 수 있다. */
const sortQuery = z.object({ sort: z.enum(["up", "taken"]).default("up"), t: z.string().optional() });

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // ── 폴더 뷰어 ─────────────────────────────────────────────────────
  // slug 와 토큰이 둘 다 맞고 공개 상태인 폴더만 열린다.
  app.get("/api/view/:gid/folder/:slug", async (req) => {
    const p = req.params as { gid: string; slug: string };
    const gid = viewerGroupId(p.gid);

    const q = sortQuery.safeParse(req.query ?? {});
    if (!q.success) throw badRequest("sort 는 up 또는 taken 이어야 합니다");
    const token = (q.data.t ?? "").trim();
    if (!token) throw notFound("링크가 올바르지 않습니다");

    // slug · 토큰 · 공개 여부가 전부 맞아야 한다. 하나라도 어긋나면 404 —
    // 비공개로 되돌린 순간 share_token 이 NULL 이 되므로 예전 링크는 여기서 죽는다.
    const folder = await db
      .selectFrom("folders")
      .innerJoin("groups", "groups.id", "folders.group_id")
      .select(["folders.id as id", "folders.name as name", "groups.name as groupName"])
      .where("folders.group_id", "=", gid)
      .where("folders.slug", "=", p.slug)
      .where("folders.pub", "=", true)
      .where("folders.share_token", "=", token)
      .where("groups.deleted_at", "is", null)
      .executeTakeFirst();
    if (!folder) throw notFound("공개되지 않았거나 만료된 링크입니다");

    // 그 폴더의 사진만. 하위 폴더는 따라가지 않는다.
    const base = db
      .selectFrom("photos")
      .select(["id", "name", "mime", "uploaded_at", "taken_at"])
      .where("folder_id", "=", folder.id);

    // 촬영 시각 메타데이터가 없으면 업로드 시각을 촬영 시각으로 믿는다 — 정렬도 같은 규칙이다.
    const rows =
      q.data.sort === "taken"
        ? await base
            .orderBy(sql`coalesce(taken_at, uploaded_at)`, "asc")
            .orderBy("id", "asc")
            .execute()
        : await base.orderBy("uploaded_at", "asc").orderBy("id", "asc").execute();

    return {
      folder: { name: folder.name },
      group: { name: folder.groupName },
      photos: rows.map((r) => {
        const uploadedAt = new Date(r.uploaded_at).toISOString();
        const fallback = r.taken_at === null;
        return {
          id: r.id,
          name: r.name,
          mime: r.mime,
          uploadedAt,
          takenAt: fallback ? uploadedAt : new Date(r.taken_at!).toISOString(),
          /** true 면 촬영 메타데이터가 없어 업로드 시각을 쓴 것 — 화면에 배지로 알린다 */
          takenFallback: fallback,
          /** 언제나 TripMate 주소다. storage_key(Drive fileId)는 밖으로 나가지 않는다 */
          url: `/api/media/${r.id}?t=${encodeURIComponent(token)}`,
        };
      }),
    };
  });

  // ── 정산 뷰어 ─────────────────────────────────────────────────────
  // 멤버가 열면 앱 정산 화면으로 보내고, 밖에서 열면 읽기 전용 정산만 보여준다.
  app.get("/api/view/:gid/settle/:token", async (req) => {
    const p = req.params as { gid: string; token: string };
    const gid = viewerGroupId(p.gid);
    const token = (p.token ?? "").trim();
    if (!token) throw notFound("링크가 올바르지 않습니다");

    const group = await db
      .selectFrom("groups")
      .select(["id", "name", "dest", "start_date", "end_date"])
      .where("id", "=", gid)
      .where("settle_token", "=", token)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!group) throw notFound("만료되었거나 잘못된 링크입니다");

    // 로그인한 (안 나간) 멤버가 열었다면 읽기 전용 뷰어를 보여 줄 이유가 없다.
    // 프론트가 이 플래그를 보고 앱의 정산 화면으로 보낸다.
    if (req.user) {
      const mine = await db
        .selectFrom("members")
        .select("id")
        .where("group_id", "=", gid)
        .where("user_id", "=", req.user.id)
        .where("left_at", "is", null)
        .executeTakeFirst();
      if (mine) return { memberView: true, groupId: gid };
    }

    const r = await loadSettlement(gid);

    // ⚠ 여기서부터가 모임 밖으로 나가는 데이터다.
    //   이름·금액·상태만 나간다. 멤버 id, 항목 제목, 일정, 문서, 사진은 하나도 넣지 않는다.
    //   (미지정·대상없음 항목 목록도 제외한다 — 항목 제목이 곧 일정 유출이다)
    return {
      memberView: false,
      group: {
        name: group.name,
        dest: group.dest,
        start: group.start_date,
        end: group.end_date,
      },
      balance: r.balance.map((b) => ({
        name: b.name,
        left: b.left, // 나간 멤버도 정산에는 그대로 남는다. 화면에는 "기타"로 표시한다
        spent: b.spent, // 실제 결제액
        owed: b.owed, // 낼 돈
        net: b.net, // 정산 반영액 − 낼 돈. 전원의 합은 정확히 0
      })),
      transfers: r.transfers.map((t) => ({
        fromName: t.fromName,
        toName: t.toName,
        amt: t.amt,
        state: t.state,
      })),
      collectors: r.collectors.map((c) => ({
        name: c.name,
        amt: c.amt,
        received: c.received,
      })),
      total: r.total,
      guestTotal: r.guestTotal,
      closed: r.closed,
    };
  });
}
