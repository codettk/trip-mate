/**
 * ══════════ 폴더 ══════════
 *
 * 사진 화면은 앨범 목록이 아니라 **폴더 탐색기**다. 멤버가 자유롭게 폴더를 만들고
 * **중첩 깊이에 제한이 없다.** 폴더별 권한도 없다 — 멤버는 모임 안의 모든 폴더를 그대로 본다.
 *
 * ⚠ 공유는 TripMate 가 관리한다. Drive 공유 링크를 밖으로 내보내지 않는다.
 *   응답에 drive_folder_id 를 절대 담지 않고, 밖으로 나가는 주소는 tripmate 뷰어 URL 하나뿐이다.
 *   비공개로 되돌리면 링크는 즉시 죽고, 다시 공개하면 새 토큰이 발급된다(services/folders.ts).
 */

import { viewerPath } from "@tripmate/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember } from "../auth/membership.ts";
import { requireAuth } from "../auth/session.ts";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { badRequest, conflict } from "../lib/http.ts";
import {
  breadcrumb,
  createFolder,
  deleteFolder,
  descendantIds,
  folderOrThrow,
  folderTree,
  renameFolder,
  setFolderPublic,
  type FolderRow,
} from "../services/folders.ts";
import { PHOTO_COLUMNS, photoView, takenTime } from "./photos.ts";

/**
 * 밖으로 나가는 폴더 모양. drive_folder_id 는 여기에 들어오지 않는다.
 * shareUrl 은 공개일 때만 존재한다 — 비공개면 null 이고, 그 순간 예전 링크는 죽는다.
 */
interface FolderView {
  id: string;
  name: string;
  slug: string;
  pub: boolean;
  shareUrl: string | null;
}

function shareUrlOf(f: FolderRow): string | null {
  if (!f.pub || !f.share_token) return null;
  return env.APP_ORIGIN + viewerPath(f.group_id, f.slug, f.share_token);
}

const folderView = (f: FolderRow): FolderView => ({
  id: f.id,
  name: f.name,
  slug: f.slug,
  pub: f.pub,
  shareUrl: shareUrlOf(f),
});

const gidParams = z.object({ gid: z.string().uuid() });
const gidFidParams = z.object({ gid: z.string().uuid(), fid: z.string().uuid() });

/** 정렬 기준. 업로드순이 기본이고 촬영순을 고를 수 있다. */
const listQuery = z.object({ sort: z.enum(["up", "taken"]).default("up") });

const nameSchema = z.string().trim().min(1, "폴더 이름을 입력하세요").max(40, "폴더 이름은 40자까지입니다");

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  /** 전체 트리. 깊이 제한이 없으므로 한 번에 내려 주고 프론트가 접었다 편다. */
  app.get("/api/groups/:gid/folders", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParams.parse(req.params);
    await requireMember(user, gid);
    return { root: await folderTree(gid) };
  });

  /** 폴더 하나 — 브레드크럼 + 하위 폴더 + 사진. 탐색기 화면이 한 번에 쓰는 응답이다. */
  app.get("/api/groups/:gid/folders/:fid", async (req) => {
    const user = await requireAuth(req);
    const { gid, fid } = gidFidParams.parse(req.params);
    const { sort } = listQuery.parse(req.query ?? {});
    await requireMember(user, gid);

    const folder = await folderOrThrow(gid, fid);
    const crumbs = await breadcrumb(gid, fid);

    const childRows = await db
      .selectFrom("folders")
      .select(["id", "group_id", "parent_id", "name", "slug", "pub", "share_token", "drive_folder_id"])
      .where("group_id", "=", gid)
      .where("parent_id", "=", fid)
      .orderBy("created_at", "asc")
      .execute();

    const childIds = childRows.map((c) => c.id);
    const counts = childIds.length
      ? await db
          .selectFrom("photos")
          .select(["folder_id", (eb) => eb.fn.countAll<string>().as("c")])
          .where("folder_id", "in", childIds)
          .groupBy("folder_id")
          .execute()
      : [];
    const countBy = new Map(counts.map((c) => [c.folder_id, Number(c.c)]));

    const rows = await db
      .selectFrom("photos")
      .select([...PHOTO_COLUMNS])
      .where("folder_id", "=", fid)
      .orderBy("uploaded_at", "asc")
      .orderBy("id", "asc")
      .execute();

    // 촬영순: 촬영 시각이 없는 항목은 업로드 시각을 촬영 시각으로 믿는다(takenFallback 배지).
    if (sort === "taken") rows.sort((a, b) => takenTime(a) - takenTime(b));

    return {
      folder: folderView(folder),
      breadcrumb: crumbs.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      children: childRows.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        pub: c.pub,
        photoCount: countBy.get(c.id) ?? 0,
      })),
      photos: rows.map(photoView),
      sort,
    };
  });

  /** 새 폴더 — 목록 위 인라인 입력에서 부른다. 중첩 깊이 제한을 두지 않는다. */
  app.post("/api/groups/:gid/folders", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParams.parse(req.params);
    await requireMember(user, gid);

    const body = z.object({ parentId: z.string().uuid(), name: nameSchema }).safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");

    const created = await createFolder({
      groupId: gid,
      parentId: body.data.parentId,
      name: body.data.name,
      userId: user.id,
    });
    return { folder: folderView(created) };
  });

  /** 이름 변경. 루트는 모임 이름을 바꿔야 바뀐다 (services 가 막는다). */
  app.patch("/api/groups/:gid/folders/:fid", async (req) => {
    const user = await requireAuth(req);
    const { gid, fid } = gidFidParams.parse(req.params);
    await requireMember(user, gid);

    const body = z.object({ name: nameSchema }).safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");

    return { folder: folderView(await renameFolder(gid, fid, body.data.name)) };
  });

  /**
   * 공개/비공개 토글.
   * 공개할 때마다 새 토큰이 나오므로 예전에 뿌린 링크는 되살아나지 않는다.
   */
  app.put("/api/groups/:gid/folders/:fid/public", async (req) => {
    const user = await requireAuth(req);
    const { gid, fid } = gidFidParams.parse(req.params);
    await requireMember(user, gid);

    const body = z.object({ pub: z.boolean() }).safeParse(req.body);
    if (!body.success) throw badRequest("pub 은 true 또는 false 여야 합니다");

    const target = await folderOrThrow(gid, fid);
    // 루트를 공개하면 모임의 모든 사진이 링크 하나로 나간다. 공유 단위는 항상 하위 폴더다.
    if (body.data.pub && target.parent_id === null) {
      throw badRequest(
        "최상위 폴더는 공개할 수 없습니다 — 모임의 사진 전부가 링크 하나로 나갑니다. 공유할 하위 폴더를 만들어 그 폴더를 공개하세요.",
      );
    }

    const updated = await setFolderPublic(gid, fid, body.data.pub);
    return { folder: folderView(updated), shareUrl: shareUrlOf(updated) };
  });

  /**
   * 삭제 — 하위 폴더까지 전부. 루트는 지울 수 없다.
   * 사진이 남아 있으면 몇 장이 사라지는지 알려주고 막는다. 조용히 지우면 안 된다.
   */
  app.delete("/api/groups/:gid/folders/:fid", async (req) => {
    const user = await requireAuth(req);
    const { gid, fid } = gidFidParams.parse(req.params);
    await requireMember(user, gid);

    const target = await folderOrThrow(gid, fid);
    if (target.parent_id === null) throw badRequest("루트 폴더는 삭제할 수 없습니다");

    const force = z
      .object({ force: z.union([z.literal("true"), z.literal("1")]).optional() })
      .safeParse(req.query ?? {});
    const confirmed = force.success && !!force.data.force;

    if (!confirmed) {
      const ids = await descendantIds(gid, fid);
      const row = await db
        .selectFrom("photos")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("folder_id", "in", ids)
        .executeTakeFirst();
      const photoCount = Number(row?.c ?? 0);
      if (photoCount > 0) {
        throw conflict(
          `"${target.name}" 폴더와 그 하위에 사진 ${photoCount}장이 있습니다. 함께 지우려면 force=true 로 다시 요청하세요.`,
          { photoCount },
        );
      }
    }

    await deleteFolder(gid, fid);
    return { ok: true };
  });
}
