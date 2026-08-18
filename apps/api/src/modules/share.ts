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
 *  · 공유 단위는 **묶음**이다. 묶음이 푼 폴더 집합(core `resolveShared`) 밖은 아무것도 열리지 않는다.
 *  · 브레드크럼은 **묶음 루트까지만**이다. 묶음 밖 조상 폴더 이름은 노출하지 않는다 —
 *    "Day 3 · 오사카" 같은 폴더명 하나가 곧 일정 유출이다.
 *  · 토큰이 어긋나면 404 다. 403 을 주면 "그 폴더가 있긴 하다"를 알려주는 셈이다.
 *  · 멤버 id·폴더 id 를 밖으로 내보내지 않는다. 뷰어 안의 이동은 slug 로 한다.
 */

import { resolveShared } from "@tripmate/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/client.ts";
import { badRequest, notFound } from "../lib/http.ts";
import { loadSettlement } from "../services/settlement.ts";
import { findShareByToken, groupFolders, type ShareLinkFull } from "../services/shares.ts";

const uuid = z.string().uuid();

/** 모임 id 가 uuid 가 아니면 DB 까지 가지 않고 404 로 끊는다 (존재 여부를 알려주지 않는다). */
function viewerGroupId(v: unknown): string {
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound("링크가 올바르지 않습니다");
  return r.data;
}

/** 정렬 기준. 기본은 업로드순이고 촬영순을 고를 수 있다. */
const sortQuery = z.object({ sort: z.enum(["up", "taken"]).default("up"), t: z.string().optional() });

function parseSort(req: FastifyRequest): { sort: "up" | "taken"; t: string } {
  const q = sortQuery.safeParse(req.query ?? {});
  if (!q.success) throw badRequest("sort 는 up 또는 taken 이어야 합니다");
  return { sort: q.data.sort, t: (q.data.t ?? "").trim() };
}

/** 세션이 이 모임의 안 나간 멤버인가. */
async function isMember(req: FastifyRequest, gid: string): Promise<boolean> {
  if (!req.user) return false;
  const m = await db
    .selectFrom("members")
    .select("id")
    .where("group_id", "=", gid)
    .where("user_id", "=", req.user.id)
    .where("left_at", "is", null)
    .executeTakeFirst();
  return !!m;
}

/**
 * 묶음 뷰어 응답을 만든다.
 *
 * `slug` 가 null 이면 묶음 루트다. 이때 **최상위 항목이 하나뿐이면 그 폴더가 곧 루트**가 된다 —
 * 폴더 하나짜리 묶음(003 으로 이관된 옛 링크가 전부 그렇다)을 열었는데 폴더 카드 한 장만
 * 덩그러니 보이면 한 번 더 눌러야 사진이 나온다. 여러 개면 고르는 화면을 보여 준다.
 */
async function renderShare(
  req: FastifyRequest,
  gid: string,
  link: ShareLinkFull,
  slug: string | null,
  sort: "up" | "taken",
) {
  const folders = await groupFolders(gid);
  const shared = resolveShared(
    link.entries,
    folders.map((f) => ({ id: f.id, parentId: f.parent_id })),
  );

  // 묶음 안에서의 "최상위" = 부모가 묶음에 없는 폴더. 이 위로는 올라갈 수 없다.
  const tops = folders.filter(
    (f) => shared.has(f.id) && !(f.parent_id !== null && shared.has(f.parent_id)),
  );

  let current = null as (typeof folders)[number] | null;
  if (slug !== null) {
    const found = folders.find((f) => f.slug === slug);
    // 묶음 집합 밖이면 존재 여부도 알려주지 않는다. 여기가 유출을 막는 마지막 문이다.
    if (!found || !shared.has(found.id)) throw notFound("공개되지 않았거나 만료된 링크입니다");
    current = found;
  } else if (tops.length === 1) {
    current = tops[0]!;
  }

  const group = await db
    .selectFrom("groups")
    .select("name")
    .where("id", "=", gid)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!group) throw notFound("공개되지 않았거나 만료된 링크입니다");

  // 브레드크럼: 현재 폴더에서 위로 올라가되 **묶음 집합을 벗어나는 순간 멈춘다.**
  const byId = new Map(folders.map((f) => [f.id, f]));
  const crumbs: { name: string; slug: string }[] = [];
  for (let cur = current; cur && shared.has(cur.id); cur = cur.parent_id ? (byId.get(cur.parent_id) ?? null) : null) {
    crumbs.unshift({ name: cur.name, slug: cur.slug });
  }

  // 목록: 현재 폴더의 직속 하위 중 묶음에 속한 것만. 루트가 가상이면 최상위 항목들.
  const children = current
    ? folders.filter((f) => f.parent_id === current!.id && shared.has(f.id))
    : tops;

  const childCounts = children.length
    ? await db
        .selectFrom("photos")
        .select(["folder_id", (eb) => eb.fn.countAll<string>().as("c")])
        .where(
          "folder_id",
          "in",
          children.map((c) => c.id),
        )
        .groupBy("folder_id")
        .execute()
    : [];
  const countBy = new Map(childCounts.map((c) => [c.folder_id, Number(c.c)]));

  // 사진은 현재 폴더의 것만. 하위 폴더 사진을 끌어와 섞지 않는다(폴더 단위로 보는 화면이다).
  let rows: {
    id: string;
    name: string;
    mime: string;
    uploaded_at: Date;
    taken_at: Date | null;
  }[] = [];
  if (current) {
    const base = db
      .selectFrom("photos")
      .select(["id", "name", "mime", "uploaded_at", "taken_at"])
      .where("folder_id", "=", current.id);
    // 촬영 시각 메타데이터가 없으면 업로드 시각을 촬영 시각으로 믿는다 — 정렬도 같은 규칙이다.
    rows =
      sort === "taken"
        ? await base.orderBy(sql`coalesce(taken_at, uploaded_at)`, "asc").orderBy("id", "asc").execute()
        : await base.orderBy("uploaded_at", "asc").orderBy("id", "asc").execute();
  }

  const t = encodeURIComponent(link.token);

  return {
    /**
     * 멤버가 열었을 때도 뷰어 내용을 그대로 준다. 자동으로 앱으로 보내지 않는다 —
     * 방장이 "밖에서는 뭐가 보이는지" 확인하려고 여는 경우가 있다.
     * 화면은 이 플래그로 "이 모임의 멤버입니다 · 앱에서 열기" 배너만 띄운다.
     */
    memberView: await isMember(req, gid),
    groupId: gid,
    group: { name: group.name },
    link: { label: link.label },
    /** null 이면 묶음 루트(폴더가 여러 개라 고르는 화면) */
    folder: current ? { name: current.name, slug: current.slug } : null,
    breadcrumb: crumbs,
    folders: children.map((c) => ({
      name: c.name,
      slug: c.slug,
      photoCount: countBy.get(c.id) ?? 0,
    })),
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
        url: `/api/media/${r.id}?t=${t}`,
      };
    }),
    sort,
  };
}

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // ── 묶음 뷰어 ─────────────────────────────────────────────────────

  /** 묶음 루트. 담긴 최상위 폴더들(하나면 그 폴더 자체)을 연다. */
  app.get("/api/view/:gid/share/:token", async (req) => {
    const p = req.params as { gid: string; token: string };
    const gid = viewerGroupId(p.gid);
    const { sort } = parseSort(req);

    const link = await findShareByToken(gid, (p.token ?? "").trim());
    if (!link) throw notFound("공개되지 않았거나 만료된 링크입니다");
    return renderShare(req, gid, link, null, sort);
  });

  /** 묶음 **안**의 폴더 하나. 묶음 집합에 없는 slug 는 404 다. */
  app.get("/api/view/:gid/share/:token/:slug", async (req) => {
    const p = req.params as { gid: string; token: string; slug: string };
    const gid = viewerGroupId(p.gid);
    const { sort } = parseSort(req);

    const link = await findShareByToken(gid, (p.token ?? "").trim());
    if (!link) throw notFound("공개되지 않았거나 만료된 링크입니다");
    return renderShare(req, gid, link, p.slug, sort);
  });

  /**
   * 옛 주소 호환 — `/api/view/:gid/folder/:slug?t=<token>`.
   * 003 마이그레이션으로 이관된 링크(토큰을 그대로 물려받았다)가 실제로 뿌려져 있다.
   * 토큰으로 묶음을 찾고, 그 slug 가 묶음 집합에 있으면 새 응답을 그대로 준다.
   */
  app.get("/api/view/:gid/folder/:slug", async (req) => {
    const p = req.params as { gid: string; slug: string };
    const gid = viewerGroupId(p.gid);
    const { sort, t } = parseSort(req);
    if (!t) throw notFound("링크가 올바르지 않습니다");

    const link = await findShareByToken(gid, t);
    if (!link) throw notFound("공개되지 않았거나 만료된 링크입니다");
    return renderShare(req, gid, link, p.slug, sort);
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
    if (await isMember(req, gid)) return { memberView: true, groupId: gid };

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
