/**
 * ══════════ 사진 · 동영상 ══════════
 *
 * 저장소는 운영자 Drive 한 곳이지만, **브라우저는 그 사실을 알 필요가 없다.**
 * 이미지도 항상 TripMate URL(`/api/media/:id`)로 나간다 — 서버가 저장소에서 받아 전달하고
 * Drive 파일 링크나 서명 URL 을 절대 노출하지 않는다. 그래야 폴더 범위를 앱이 통제할 수 있다.
 *
 * 업로드 대상은 **지금 열어 둔 폴더**다. 촬영 시각 등으로 자동 분류해 다른 폴더로 옮기지 않는다.
 * EXIF 촬영 시각은 정렬(촬영순)에만 쓴다. 없으면 업로드 시각을 촬영 시각으로 믿고 배지로 알린다.
 */

import exifr from "exifr";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireMember } from "../auth/membership.ts";
import { requireAuth, type AuthUser } from "../auth/session.ts";
import { db } from "../db/client.ts";
import { env, MAX_UPLOAD_BYTES } from "../env.ts";
import { badRequest, forbidden, notFound, tooLarge } from "../lib/http.ts";
import { breadcrumb, folderOrThrow, type FolderRow } from "../services/folders.ts";
import { findShareByToken, sharedIdsOf } from "../services/shares.ts";
import { ALLOWED_MIME, storage } from "../storage/index.ts";

// ── 응답 모양 ───────────────────────────────────────────────────────
// ⚠ storage_key 는 이 안에 절대 들어가지 않는다. 나가는 건 우리 URL 하나뿐이다.

/** photoView 가 필요로 하는 컬럼만. 쿼리에서 이 다섯 + id 만 뽑는다. */
export interface PhotoViewRow {
  id: string;
  name: string;
  mime: string;
  size_bytes: string | number;
  folder_id: string;
  uploaded_at: Date | string;
  taken_at: Date | string | null;
}

export interface PhotoView {
  id: string;
  name: string;
  mime: string;
  size: number;
  folderId: string;
  uploadedAt: string;
  takenAt: string;
  /** true 면 촬영 메타데이터가 없어 업로드 시각을 쓴 것 — 화면에 배지로 알린다 */
  takenFallback: boolean;
  /** 항상 /api/media/:id. Drive 링크나 서명 URL 을 절대 넣지 않는다 */
  url: string;
}

export function photoView(p: PhotoViewRow): PhotoView {
  const uploadedAt = new Date(p.uploaded_at);
  const fallback = p.taken_at === null || p.taken_at === undefined;
  return {
    id: p.id,
    name: p.name,
    mime: p.mime,
    size: Number(p.size_bytes),
    folderId: p.folder_id,
    uploadedAt: uploadedAt.toISOString(),
    takenAt: fallback ? uploadedAt.toISOString() : new Date(p.taken_at!).toISOString(),
    takenFallback: fallback,
    url: `/api/media/${p.id}`,
  };
}

/** 촬영순 정렬 기준. 촬영 시각이 없으면 업로드 시각을 촬영 시각으로 믿는다. */
export const takenTime = (p: PhotoViewRow): number =>
  new Date(p.taken_at ?? p.uploaded_at).getTime();

/** DB 에서 뽑을 컬럼 목록 — 여기에 storage_key 를 넣지 말 것. */
export const PHOTO_COLUMNS = [
  "id",
  "name",
  "mime",
  "size_bytes",
  "folder_id",
  "uploaded_at",
  "taken_at",
] as const;

// ── EXIF ────────────────────────────────────────────────────────────

interface ExifInfo {
  takenAt: Date | null;
  width: number | null;
  height: number | null;
}

const EMPTY_EXIF: ExifInfo = { takenAt: null, width: null, height: null };

/**
 * 촬영 시각과 크기를 EXIF 에서 읽는다.
 * ⚠ 절대 throw 하지 않는다 — 메타데이터가 깨졌다고 업로드가 실패하면 안 된다.
 *   읽지 못하면 null 로 두고, 정렬에서 업로드 시각으로 대체한다(takenFallback).
 */
async function readExif(body: Buffer, mime: string): Promise<ExifInfo> {
  if (!mime.startsWith("image/")) return EMPTY_EXIF; // 동영상은 EXIF 가 없다
  try {
    const raw: unknown = await exifr.parse(body, [
      "DateTimeOriginal",
      "CreateDate",
      "ExifImageWidth",
      "ExifImageHeight",
      "ImageWidth",
      "ImageHeight",
    ]);
    if (!raw || typeof raw !== "object") return EMPTY_EXIF;
    const tag = raw as Record<string, unknown>;

    const when = toDate(tag.DateTimeOriginal) ?? toDate(tag.CreateDate);
    const width = toInt(tag.ExifImageWidth) ?? toInt(tag.ImageWidth);
    const height = toInt(tag.ExifImageHeight) ?? toInt(tag.ImageHeight);
    return { takenAt: when, width, height };
  } catch {
    return EMPTY_EXIF;
  }
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// ── 저장소 폴더 보장 ────────────────────────────────────────────────

/**
 * 이 폴더의 저장소 폴더 id 를 돌려준다. 없으면 **루트부터 조상 순서대로** 만들어 채운다.
 * (폴더는 DB 에 먼저 생기고 저장소 폴더는 나중에 붙을 수 있다 — 첫 업로드 때 여기서 메운다.)
 */
async function ensureStorageFolder(groupId: string, folder: FolderRow): Promise<string> {
  if (folder.drive_folder_id) return folder.drive_folder_id;

  const chain = await breadcrumb(groupId, folder.id); // 루트 → … → 대상 순서
  const s = await storage();
  let parentId: string | null = null;

  for (const f of chain) {
    let id = f.drive_folder_id;
    if (!id) {
      id = await s.createFolder(f.name, parentId);
      await db
        .updateTable("folders")
        .set({ drive_folder_id: id, updated_at: new Date() })
        .where("id", "=", f.id)
        .execute();
      // 루트 폴더 id 는 모임에도 들고 있다 (groups.drive_folder_id)
      if (f.parent_id === null) {
        await db.updateTable("groups").set({ drive_folder_id: id }).where("id", "=", groupId).execute();
      }
    }
    parentId = id;
  }

  if (!parentId) throw new Error("저장소 폴더를 만들지 못했습니다");
  return parentId;
}

// ── 라우트 ──────────────────────────────────────────────────────────

const groupParams = z.object({ gid: z.string().uuid() });
const groupFolderParams = z.object({ gid: z.string().uuid(), fid: z.string().uuid() });
const groupPhotoParams = z.object({ gid: z.string().uuid(), pid: z.string().uuid() });

/**
 * 사진 수정 본문.
 * `takenAt` 은 **null 을 명시적으로 받는다** — 잘못 넣은 촬영 시각을 되돌려야 하기 때문이다.
 * 키가 아예 없으면(undefined) 건드리지 않는다. 둘을 구분하지 않으면 이름만 고칠 때 촬영 시각이 날아간다.
 */
const patchPhotoBody = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요").max(200, "이름은 200자까지입니다").optional(),
  takenAt: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === null) return v;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "촬영 시각이 올바르지 않습니다" });
        return z.NEVER;
      }
      return d;
    }),
  folderId: z.string().uuid().optional(),
});

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 업로드 — 지금 열어 둔 폴더에 올린다.
   * 형식이 맞지 않는 파일은 그것만 건너뛰고 이유를 돌려준다. 한 장 때문에 전체가 실패하면 안 된다.
   */
  app.post("/api/groups/:gid/folders/:fid/photos", async (req) => {
    const user = await requireAuth(req);
    const { gid, fid } = groupFolderParams.parse(req.params);
    await requireMember(user, gid);

    const folder = await folderOrThrow(gid, fid);
    const parentId = await ensureStorageFolder(gid, folder);
    const s = await storage();

    const uploaded: PhotoView[] = [];
    const failed: { name: string; reason: string }[] = [];
    let sawFile = false;

    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      sawFile = true;
      const name = part.filename?.trim() || "이름없는 파일";

      if (!ALLOWED_MIME.has(part.mimetype)) {
        part.file.resume(); // 스트림을 비워야 다음 파트로 넘어간다
        failed.push({ name, reason: `지원하지 않는 형식입니다 (${part.mimetype})` });
        continue;
      }

      let body: Buffer;
      try {
        body = await part.toBuffer();
      } catch (e) {
        // @fastify/multipart 가 limits.fileSize 를 넘기면 여기서 터진다 → 413
        if (isTooLarge(e)) {
          throw tooLarge(`${name} 이(가) 너무 큽니다. 최대 ${env.MAX_UPLOAD_MB}MB 까지 올릴 수 있습니다`);
        }
        throw e;
      }
      if (body.byteLength > MAX_UPLOAD_BYTES) {
        throw tooLarge(`${name} 이(가) 너무 큽니다. 최대 ${env.MAX_UPLOAD_MB}MB 까지 올릴 수 있습니다`);
      }

      const exif = await readExif(body, part.mimetype);
      const stored = await s.upload({ parentId, name, mime: part.mimetype, body });

      const row = await db
        .insertInto("photos")
        .values({
          group_id: gid,
          folder_id: folder.id, // ← 자동 분류하지 않는다. 열어 둔 폴더 그대로
          name,
          mime: part.mimetype,
          size_bytes: stored.size,
          width: exif.width,
          height: exif.height,
          storage_key: stored.key,
          uploaded_by: user.id,
          taken_at: exif.takenAt,
        })
        .returning([...PHOTO_COLUMNS])
        .executeTakeFirstOrThrow();

      uploaded.push(photoView(row));
    }

    if (!sawFile) throw badRequest("업로드할 파일이 없습니다");
    return { uploaded, failed };
  });

  /** 삭제 — 올린 사람 또는 방장만. */
  app.delete("/api/groups/:gid/photos/:pid", async (req) => {
    const user = await requireAuth(req);
    const { gid, pid } = groupPhotoParams.parse(req.params);
    const me = await requireMember(user, gid);

    const p = await db
      .selectFrom("photos")
      .select(["id", "name", "storage_key", "uploaded_by"])
      .where("id", "=", pid)
      .where("group_id", "=", gid)
      .executeTakeFirst();
    if (!p) throw notFound("사진을 찾을 수 없습니다");

    if (p.uploaded_by !== user.id && !me.isOwner) {
      throw forbidden("올린 사람 또는 방장만 삭제할 수 있습니다");
    }

    await db.deleteFrom("photos").where("id", "=", pid).execute();

    // 저장소에서 지우지 못해도 DB 삭제는 되돌리지 않는다 — 화면에서 사라지는 게 먼저다.
    try {
      const s = await storage();
      await s.deleteFile(p.storage_key);
    } catch (e) {
      req.log.warn({ err: e, photoId: pid }, "저장소 파일 삭제 실패");
    }
    return { ok: true };
  });

  /**
   * 수정 — 이름 · 촬영 시각 · 폴더. 사진 상세 모달에서 그 자리에 고친다.
   * 권한은 삭제와 같다(올린 사람 또는 방장) — 남이 올린 사진을 조용히 옮기거나 이름을 바꾸면
   * 누가 뭘 했는지 알 수 없게 된다.
   */
  app.patch("/api/groups/:gid/photos/:pid", async (req) => {
    const user = await requireAuth(req);
    const { gid, pid } = groupPhotoParams.parse(req.params);
    const me = await requireMember(user, gid);

    const body = patchPhotoBody.safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");
    const patch = body.data;
    if (patch.name === undefined && patch.takenAt === undefined && patch.folderId === undefined) {
      throw badRequest("바꿀 값이 없습니다");
    }

    const p = await db
      .selectFrom("photos")
      .select(["id", "name", "folder_id", "storage_key", "uploaded_by"])
      .where("id", "=", pid)
      .where("group_id", "=", gid)
      .executeTakeFirst();
    if (!p) throw notFound("사진을 찾을 수 없습니다");
    if (p.uploaded_by !== user.id && !me.isOwner) {
      throw forbidden("올린 사람 또는 방장만 수정할 수 있습니다");
    }

    // 다른 모임 폴더로는 옮길 수 없다. folderOrThrow 가 모임까지 확인한다.
    if (patch.folderId !== undefined) await folderOrThrow(gid, patch.folderId);

    const set: { name?: string; taken_at?: Date | null; folder_id?: string } = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.folderId !== undefined) set.folder_id = patch.folderId;
    // null 이면 촬영 시각을 지운다 → 다시 업로드 시각을 촬영 시각으로 믿는 상태(takenFallback)로 돌아간다.
    // 잘못 넣은 값을 되돌릴 방법이 없으면 안 되기 때문에 명시적으로 null 을 받는다.
    if (patch.takenAt !== undefined) set.taken_at = patch.takenAt;

    const row = await db
      .updateTable("photos")
      .set(set)
      .where("id", "=", pid)
      .returning(PHOTO_COLUMNS)
      .executeTakeFirstOrThrow();

    // 저장소 쪽 이름도 따라간다 — 모임 이름 → Drive 폴더명 규칙과 같은 이유다.
    // 저장소만 옛 이름으로 남으면 나중에 Drive 를 직접 열어 대조할 때 어느 파일인지 알 수 없다.
    // storage_key 는 바뀌지 않으므로 이미 나간 링크가 깨지지 않는다.
    //
    // 실패해도 요청을 세우지 않는다. DB 가 정본이고 화면에 보이는 이름은 이미 바뀌었다 —
    // Drive 쪽 이름 하나 때문에 사용자의 수정을 되돌리는 게 더 나쁘다.
    if (patch.name !== undefined && patch.name !== p.name) {
      const s = await storage();
      await s.renameFile(p.storage_key, patch.name).catch((e: unknown) => {
        req.log.warn({ err: e, photoId: pid }, "저장소 파일명 변경 실패 — DB 이름만 바뀝니다");
      });
    }

    // ⚠ 폴더를 옮겨도 저장소 파일은 옮기지 않는다. 파일은 storage_key 로만 찾고
    //   그 값은 그대로이므로 접근에 아무 차이가 없다. Drive 안의 배치만 옛 폴더에 남는다.

    return { photo: photoView(row) };
  });

  /**
   * 여러 장 이동 — 그리드에서 골라 한 번에 옮긴다.
   * 한 장이 막혀도 나머지는 옮긴다. 업로드 라우트와 같은 모양(moved/failed)으로 돌려준다 —
   * 부분 실패를 통째 실패로 만들면 사용자가 뭐가 됐는지 알 수 없다.
   */
  app.post("/api/groups/:gid/photos/move", async (req) => {
    const user = await requireAuth(req);
    const { gid } = groupParams.parse(req.params);
    const me = await requireMember(user, gid);

    const body = z
      .object({
        ids: z.array(z.string().uuid()).min(1, "옮길 사진을 고르세요"),
        folderId: z.string().uuid(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");

    const target = await folderOrThrow(gid, body.data.folderId);

    const ids = [...new Set(body.data.ids)];
    const rows = await db
      .selectFrom("photos")
      .select(["id", "name", "folder_id", "uploaded_by"])
      .where("id", "in", ids)
      .where("group_id", "=", gid)
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));

    const movable: string[] = [];
    const failed: { id: string; name: string | null; reason: string }[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) {
        failed.push({ id, name: null, reason: "사진을 찾을 수 없습니다" });
        continue;
      }
      if (r.uploaded_by !== user.id && !me.isOwner) {
        failed.push({ id, name: r.name, reason: "올린 사람 또는 방장만 옮길 수 있습니다" });
        continue;
      }
      if (r.folder_id === target.id) continue; // 이미 그 폴더다. 실패도 이동도 아니다
      movable.push(id);
    }

    const moved = movable.length
      ? await db
          .updateTable("photos")
          .set({ folder_id: target.id })
          .where("id", "in", movable)
          .returning(PHOTO_COLUMNS)
          .execute()
      : [];

    return { moved: moved.map(photoView), failed };
  });

  // ── 미디어 스트림 ─────────────────────────────────────────────────
  // 이미지 자체도 TripMate URL 로 나간다. Drive 링크·서명 URL 을 브라우저에 주지 않는다.
  app.get("/api/media/:pid", (req, reply) => serveMedia(req, reply));

  /**
   * 썸네일 — 지금은 트랜스코딩을 하지 않으므로 **원본과 같은 스트림**을 준다.
   * (리사이즈 파이프라인이 생기기 전까지 경로만 먼저 열어 둔다. 프론트가 나중에 바꾸지 않아도 되게.)
   */
  app.get("/api/media/:pid/thumb", (req, reply) => serveMedia(req, reply));
}

// ── 접근 제어 ───────────────────────────────────────────────────────

/**
 * 미디어를 볼 수 있는 경우는 둘뿐이다.
 *  1. 로그인한 사람이 그 모임의 안 나간 멤버다 (멤버는 모든 폴더를 그대로 본다)
 *  2. ?t= 토큰이 가리키는 **묶음의 폴더 집합에 이 사진의 폴더가 들어 있다**
 *
 * ⚠ 여기가 사진 유출을 막는 마지막 문이다. 폴더가 묶음 집합 밖이면 그 토큰으로 열리지 않는다.
 *   집합을 푸는 계산은 core 의 `resolveShared` 한 벌뿐이다(services/shares.ts) —
 *   공유 모달이 "이 폴더들이 나갑니다" 라고 센 것과 이 검사가 다르면 그 차이가 곧 유출이다.
 *   토큰 비교(safeEqual)도 findShareByToken 안에 있다. 규칙을 이 파일에 복제하지 않는다.
 */
async function canSeeMedia(
  user: AuthUser | null,
  photo: { group_id: string; folder_id: string },
  token: string | null,
): Promise<boolean> {
  if (user) {
    const m = await db
      .selectFrom("members")
      .select("id")
      .where("group_id", "=", photo.group_id)
      .where("user_id", "=", user.id)
      .where("left_at", "is", null)
      .executeTakeFirst();
    if (m) return true;
  }

  if (!token) return false;
  const link = await findShareByToken(photo.group_id, token);
  if (!link) return false;
  const shared = await sharedIdsOf(link);
  return shared.has(photo.folder_id);
}

const mediaParams = z.object({ pid: z.string().uuid() });
const mediaQuery = z.object({ t: z.string().min(1).optional() });

async function serveMedia(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // 권한이 없으면 404 로 답한다 — 존재 자체를 알려주지 않는다.
  const missing = notFound("사진을 찾을 수 없습니다");

  const params = mediaParams.safeParse(req.params);
  if (!params.success) throw missing;
  const q = mediaQuery.safeParse(req.query);
  const token = q.success ? (q.data.t ?? null) : null;

  const p = await db
    .selectFrom("photos")
    .select(["id", "group_id", "folder_id", "mime", "size_bytes", "storage_key"])
    .where("id", "=", params.data.pid)
    .executeTakeFirst();
  if (!p) throw missing;

  if (!(await canSeeMedia(req.user, p, token))) throw missing;

  const s = await storage();
  const stream = await s.stream(p.storage_key);

  const size = Number(p.size_bytes);
  reply.header("Content-Type", p.mime);
  if (Number.isFinite(size) && size > 0) reply.header("Content-Length", size);
  // 파일 내용은 바뀌지 않는다 (지우고 새로 올리면 id 가 달라진다) → 오래 캐시해도 안전하다.
  // private 인 이유: 공유 링크가 죽은 뒤 공용 캐시가 대신 내주면 안 되기 때문이다.
  reply.header("Cache-Control", "private, max-age=31536000, immutable");
  reply.header("X-Content-Type-Options", "nosniff");
  return reply.send(stream);
}

/** multipart 의 파일 크기 초과 에러인가. */
function isTooLarge(e: unknown): boolean {
  const err = e as { code?: string; statusCode?: number };
  return err?.code === "FST_REQ_FILE_TOO_LARGE" || err?.statusCode === 413;
}
