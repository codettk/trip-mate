/**
 * 문서 라우트.
 *
 * 문서는 **모임 멤버 전용**이다. 외부 공개 토글도, 공유 링크도 만들지 않는다 —
 * 밖으로 나가는 것은 미디어(사진·동영상)뿐이고 유일한 예외는 정산 공유 링크다.
 * 그래서 이 파일에는 pub / token / share 라는 단어가 아예 등장하지 않는다.
 *
 * 문서는 일차에 묶이지 않는 자유 문서다. day_id 를 갖지 않고, 블록을 얹어서 만든다.
 *
 * 동시 편집은 "마지막 저장 승리 + 낙관적 잠금"이다 (docs/decisions 의 K항).
 * 클라이언트가 들고 있던 version 이 DB 와 다르면 409 로 거부하고 현재 문서를 함께 돌려준다 —
 * 조용히 덮어쓰면 남이 쓴 제목이 사라진다.
 */

import { BLOCK_KINDS, type BlockKind } from "@tripmate/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember } from "../auth/membership.ts";
import { requireAuth } from "../auth/session.ts";
import { db } from "../db/client.ts";
import { badRequest, conflict, notFound } from "../lib/http.ts";
import type { Transaction } from "kysely";
import type { Database } from "../db/types.ts";

const gidParam = z.object({ gid: z.string().uuid() });
const docParam = z.object({ gid: z.string().uuid(), did: z.string().uuid() });
const blockParam = z.object({
  gid: z.string().uuid(),
  did: z.string().uuid(),
  bid: z.string().uuid(),
});

const titleField = z.string().trim().min(1, "문서 제목을 입력하세요").max(80);

const createBody = z.object({ title: titleField.optional() });

const patchBody = z.object({
  title: titleField.optional(),
  // 낙관적 잠금의 근거. 없으면 무엇을 기준으로 충돌을 판정할지 알 수 없으므로 필수다.
  version: z.number().int().positive({ message: "version 을 함께 보내야 합니다" }),
});

const blockCreateBody = z.object({
  kind: z.enum(BLOCK_KINDS),
  position: z.number().int().min(0).optional(),
});

const blockPatchBody = z
  .object({
    // jsonb 최상위는 항상 객체다. 배열이나 원시값을 넣으면 블록마다 모양이 달라져 렌더가 갈린다.
    content: z.record(z.unknown()).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((v) => v.content !== undefined || v.position !== undefined, {
    message: "content 또는 position 중 하나는 있어야 합니다",
  });

/**
 * 블록 종류별 기본 content — 서버가 채운다. 클라이언트가 모양을 정하면 두 벌이 어긋난다.
 *
 * 모양은 프로토타입 KIND.make() 와 같게 두되 **내용은 비운다.**
 * 프로토타입의 예시 행("우도 도선 탑승" 같은 것)을 그대로 넣으면
 * 새 블록을 만든 사람이 남의 일정부터 지워야 한다.
 */
function defaultContent(kind: BlockKind): Record<string, unknown> {
  switch (kind) {
    case "timetable":
      // [시각, 내용, 메모] 한 줄. 바로 타이핑할 수 있게 빈 줄 하나를 준다.
      return { rows: [["", "", ""]] };
    case "map":
      // [이름, x%, y%] — 사용자가 지도를 눌러 찍는다
      return { pins: [] };
    case "stay":
      // [숙소명, 기간, 금액]
      return { rows: [["", "", 0]] };
    case "settle":
      // ⚠ 정산 수치를 여기에 복사하지 않는다.
      //   금액이 바뀌면 문서 안의 숫자가 조용히 틀려진다 — 화면이 그릴 때 정산 API 를 부른다.
      return {};
    case "memo":
      return { text: "" };
  }
}

type DocRow = {
  id: string;
  title: string;
  version: number;
  updated_at: Date;
};

const serializeDoc = (d: DocRow) => ({
  id: d.id,
  title: d.title,
  version: d.version,
  updatedAt: d.updated_at,
});

type BlockRow = {
  id: string;
  kind: BlockKind;
  position: number;
  content: unknown;
};

const serializeBlock = (b: BlockRow) => ({
  id: b.id,
  kind: b.kind,
  position: b.position,
  content: (b.content ?? {}) as Record<string, unknown>,
});

/** 이 모임의 문서인지까지 확인한다. 다른 모임의 문서 id 를 알아도 열 수 없어야 한다. */
async function docOrThrow(groupId: string, docId: string): Promise<DocRow> {
  const row = await db
    .selectFrom("docs")
    .select(["id", "title", "version", "updated_at"])
    .where("id", "=", docId)
    .where("group_id", "=", groupId)
    .executeTakeFirst();
  if (!row) throw notFound("문서를 찾을 수 없습니다");
  return row as DocRow;
}

async function loadBlocks(docId: string): Promise<BlockRow[]> {
  const rows = await db
    .selectFrom("doc_blocks")
    .select(["id", "kind", "position", "content"])
    .where("doc_id", "=", docId)
    .orderBy("position", "asc")
    .orderBy("id", "asc")
    .execute();
  return rows as BlockRow[];
}

/** 블록이 바뀌면 문서도 바뀐 것이다 — 목록의 "최근 수정순"이 어긋나면 안 된다. */
async function touchDoc(trx: Transaction<Database>, docId: string): Promise<void> {
  await trx.updateTable("docs").set({ updated_at: new Date() }).where("id", "=", docId).execute();
}

/**
 * position 을 0,1,2… 로 다시 촘촘하게 매긴다.
 * 구멍이나 중복이 남으면 정렬 타이브레이커(id)에 순서가 끌려가 문서가 뒤섞인다.
 */
async function resequence(
  trx: Transaction<Database>,
  orderedIds: string[],
): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await trx
      .updateTable("doc_blocks")
      .set({ position: i })
      .where("id", "=", orderedIds[i]!)
      .execute();
  }
}

export async function docRoutes(app: FastifyInstance): Promise<void> {
  // ── 목록 ──────────────────────────────────────────────────────────
  // 사이드바의 문서 화면이 쓴다. 최근 수정순 — 방금 손댄 문서가 맨 위에 있어야 한다.
  app.get("/api/groups/:gid/docs", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    await requireMember(user, gid);

    const rows = await db
      .selectFrom("docs")
      .leftJoin("doc_blocks", "doc_blocks.doc_id", "docs.id")
      .select([
        "docs.id as id",
        "docs.title as title",
        "docs.version as version",
        "docs.updated_at as updated_at",
        (eb) => eb.fn.count<string>("doc_blocks.id").as("block_count"),
      ])
      .where("docs.group_id", "=", gid)
      .groupBy(["docs.id", "docs.title", "docs.version", "docs.updated_at"])
      .orderBy("docs.updated_at", "desc")
      .orderBy("docs.id", "asc")
      .execute();

    return {
      docs: rows.map((r) => ({
        id: r.id,
        title: r.title,
        blockCount: Number(r.block_count),
        updatedAt: r.updated_at,
        version: r.version,
      })),
    };
  });

  // ── 생성 ──────────────────────────────────────────────────────────
  // 목록 위 인라인 입력으로 만든다 — 폼 페이지가 없으므로 만들어진 문서 전체를 돌려준다.
  // 화면이 바로 그 문서를 펼칠 수 있어야 한다.
  app.post("/api/groups/:gid/docs", async (req, reply) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    await requireMember(user, gid);

    const body = createBody.safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");

    const row = await db
      .insertInto("docs")
      .values({
        group_id: gid,
        title: body.data.title ?? "제목 없는 문서",
        created_by: user.id,
      })
      .returning(["id", "title", "version", "updated_at"])
      .executeTakeFirstOrThrow();

    // 빈 문서로 시작한다. 블록은 사용자가 얹는다 — 임의의 블록을 미리 넣으면 지우는 일부터 하게 된다.
    return reply.status(201).send({ doc: serializeDoc(row as DocRow), blocks: [] });
  });

  // ── 상세 ──────────────────────────────────────────────────────────
  app.get("/api/groups/:gid/docs/:did", async (req) => {
    const user = await requireAuth(req);
    const { gid, did } = docParam.parse(req.params);
    await requireMember(user, gid);

    const doc = await docOrThrow(gid, did);
    return { doc: serializeDoc(doc), blocks: (await loadBlocks(did)).map(serializeBlock) };
  });

  // ── 제목 수정 (낙관적 잠금) ───────────────────────────────────────
  app.patch("/api/groups/:gid/docs/:did", async (req) => {
    const user = await requireAuth(req);
    const { gid, did } = docParam.parse(req.params);
    await requireMember(user, gid);

    const body = patchBody.safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");

    await docOrThrow(gid, did);

    // version 이 맞을 때만 갱신한다. WHERE 에 version 을 걸어 두 요청이 동시에 와도
    // 한쪽만 통과하게 만든다 — 읽고 나서 쓰는 사이에 끼어들 틈을 없앤다.
    const updated = await db
      .updateTable("docs")
      .set({
        ...(body.data.title !== undefined ? { title: body.data.title } : {}),
        version: body.data.version + 1,
        updated_at: new Date(),
      })
      .where("id", "=", did)
      .where("version", "=", body.data.version)
      .returning(["id", "title", "version", "updated_at"])
      .executeTakeFirst();

    if (!updated) {
      // 충돌. 지금 DB 에 있는 문서를 그대로 담아 준다 — 화면이 "이게 현재 내용입니다"를 보여줄 수 있어야 한다.
      const current = await docOrThrow(gid, did);
      throw conflict("다른 사람이 먼저 저장했습니다", {
        doc: serializeDoc(current),
        blocks: (await loadBlocks(did)).map(serializeBlock),
      });
    }

    return { doc: serializeDoc(updated as DocRow) };
  });

  // ── 삭제 ──────────────────────────────────────────────────────────
  // 블록은 ON DELETE CASCADE 로 함께 사라진다.
  app.delete("/api/groups/:gid/docs/:did", async (req) => {
    const user = await requireAuth(req);
    const { gid, did } = docParam.parse(req.params);
    await requireMember(user, gid);

    await docOrThrow(gid, did);
    await db.deleteFrom("docs").where("id", "=", did).execute();
    return { ok: true };
  });

  // ── 블록 추가 ─────────────────────────────────────────────────────
  app.post("/api/groups/:gid/docs/:did/blocks", async (req, reply) => {
    const user = await requireAuth(req);
    const { gid, did } = docParam.parse(req.params);
    await requireMember(user, gid);

    const body = blockCreateBody.safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "블록 종류가 올바르지 않습니다");

    await docOrThrow(gid, did);

    const block = await db.transaction().execute(async (trx) => {
      const siblings = await trx
        .selectFrom("doc_blocks")
        .select(["id"])
        .where("doc_id", "=", did)
        .orderBy("position", "asc")
        .orderBy("id", "asc")
        .execute();

      // position 을 안 주면 맨 뒤. 범위를 벗어나면 잘라 붙인다(에러로 막을 만한 일이 아니다).
      const at = Math.min(body.data.position ?? siblings.length, siblings.length);

      const inserted = await trx
        .insertInto("doc_blocks")
        .values({
          doc_id: did,
          kind: body.data.kind,
          position: at,
          content: JSON.stringify(defaultContent(body.data.kind)),
        })
        .returning(["id", "kind", "position", "content"])
        .executeTakeFirstOrThrow();

      const ids = siblings.map((s) => s.id);
      ids.splice(at, 0, inserted.id);
      await resequence(trx, ids);
      await touchDoc(trx, did);

      return { ...(inserted as BlockRow), position: at };
    });

    return reply.status(201).send({ block: serializeBlock(block) });
  });

  // ── 블록 수정 ─────────────────────────────────────────────────────
  // content 만 바꾸든, 순서만 옮기든, 둘 다든 이 하나로 처리한다 (모달·인라인 편집).
  app.patch("/api/groups/:gid/docs/:did/blocks/:bid", async (req) => {
    const user = await requireAuth(req);
    const { gid, did, bid } = blockParam.parse(req.params);
    await requireMember(user, gid);

    const body = blockPatchBody.safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");

    await docOrThrow(gid, did);
    const current = await db
      .selectFrom("doc_blocks")
      .select(["id", "kind"])
      .where("id", "=", bid)
      .where("doc_id", "=", did)
      .executeTakeFirst();
    if (!current) throw notFound("블록을 찾을 수 없습니다");

    // 정산서 블록은 내용을 갖지 않는다. 여기에 숫자를 저장하면 정산이 바뀌어도 문서만 옛 금액을 들고 있게 된다.
    if (current.kind === "settle" && body.data.content && Object.keys(body.data.content).length > 0) {
      throw badRequest("정산서 블록은 내용을 저장하지 않습니다 — 화면이 정산 API 를 불러 그립니다");
    }

    const blocks = await db.transaction().execute(async (trx) => {
      if (body.data.content !== undefined) {
        await trx
          .updateTable("doc_blocks")
          .set({ content: JSON.stringify(body.data.content) })
          .where("id", "=", bid)
          .execute();
      }

      if (body.data.position !== undefined) {
        const siblings = await trx
          .selectFrom("doc_blocks")
          .select(["id"])
          .where("doc_id", "=", did)
          .orderBy("position", "asc")
          .orderBy("id", "asc")
          .execute();

        const ids = siblings.map((s) => s.id).filter((id) => id !== bid);
        const at = Math.min(body.data.position, ids.length);
        ids.splice(at, 0, bid);
        // 뺀 자리에 구멍이 남고 끼운 자리에 중복이 생기므로 형제 전체를 다시 매긴다.
        await resequence(trx, ids);
      }

      await touchDoc(trx, did);

      return trx
        .selectFrom("doc_blocks")
        .select(["id", "kind", "position", "content"])
        .where("doc_id", "=", did)
        .orderBy("position", "asc")
        .orderBy("id", "asc")
        .execute();
    });

    const all = (blocks as BlockRow[]).map(serializeBlock);
    return { block: all.find((b) => b.id === bid)!, blocks: all };
  });

  // ── 블록 삭제 ─────────────────────────────────────────────────────
  app.delete("/api/groups/:gid/docs/:did/blocks/:bid", async (req) => {
    const user = await requireAuth(req);
    const { gid, did, bid } = blockParam.parse(req.params);
    await requireMember(user, gid);

    await docOrThrow(gid, did);
    const exists = await db
      .selectFrom("doc_blocks")
      .select("id")
      .where("id", "=", bid)
      .where("doc_id", "=", did)
      .executeTakeFirst();
    if (!exists) throw notFound("블록을 찾을 수 없습니다");

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("doc_blocks").where("id", "=", bid).execute();

      const rest = await trx
        .selectFrom("doc_blocks")
        .select(["id"])
        .where("doc_id", "=", did)
        .orderBy("position", "asc")
        .orderBy("id", "asc")
        .execute();
      await resequence(trx, rest.map((r) => r.id));
      await touchDoc(trx, did);
    });

    return { ok: true };
  });
}
