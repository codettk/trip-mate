/**
 * ══════════ 폴더 ══════════
 *
 * 사진 화면은 앨범 목록이 아니라 **폴더 탐색기**다. 멤버가 자유롭게 폴더를 만들고
 * **중첩 깊이에 제한이 없다.** 폴더별 권한도 없다 — 멤버는 모임 안의 모든 폴더를 그대로 본다.
 *
 * ⚠ 공유는 TripMate 가 관리하고, 단위는 폴더가 아니라 **묶음**이다(modules/shares.ts).
 *   그래서 여기에는 공개 토글이 없다. 폴더가 밖으로 나가는지는 `sharedIn`(담고 있는 묶음 id)으로만 말한다.
 *   응답에 drive_folder_id 를 절대 담지 않는다 — Drive 링크는 어떤 경로로도 브라우저에 가지 않는다.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember } from "../auth/membership.ts";
import { requireAuth } from "../auth/session.ts";
import { db } from "../db/client.ts";
import { badRequest, conflict } from "../lib/http.ts";
import {
  breadcrumb,
  createFolder,
  deleteFolder,
  descendantIds,
  folderOrThrow,
  folderTree,
  moveFolder,
  renameFolder,
  type FolderRow,
} from "../services/folders.ts";
import { sharedInMap } from "../services/shares.ts";
import { PHOTO_COLUMNS, photoView, takenTime } from "./photos.ts";

/**
 * 밖으로 나가는 폴더 모양. drive_folder_id 는 여기에 들어오지 않는다.
 * `sharedIn` 이 비어 있지 않으면 그 폴더의 미디어가 밖으로 나가는 중이다.
 */
interface FolderView {
  id: string;
  name: string;
  slug: string;
  sharedIn: string[];
}

const folderView = (f: FolderRow, shared: Map<string, string[]>): FolderView => ({
  id: f.id,
  name: f.name,
  slug: f.slug,
  sharedIn: shared.get(f.id) ?? [],
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
    const shared = await sharedInMap(gid);

    const childRows = await db
      .selectFrom("folders")
      .select(["id", "name", "slug"])
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
      .select(PHOTO_COLUMNS)
      .where("folder_id", "=", fid)
      .orderBy("uploaded_at", "asc")
      .orderBy("id", "asc")
      .execute();

    // 촬영순: 촬영 시각이 없는 항목은 업로드 시각을 촬영 시각으로 믿는다(takenFallback 배지).
    if (sort === "taken") rows.sort((a, b) => takenTime(a) - takenTime(b));

    return {
      folder: folderView(folder, shared),
      breadcrumb: crumbs.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      children: childRows.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        sharedIn: shared.get(c.id) ?? [],
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
    // 갓 만든 폴더는 어느 묶음에도 없다… 단, includeDescendants 묶음 **아래**에 만들었다면
    // 태어나자마자 밖으로 나간다. 그래서 계산해서 알려 준다 — 모르고 새는 경로가 없어야 한다.
    return { folder: folderView(created, await sharedInMap(gid)) };
  });

  /**
   * 이름 변경 · 이동. 둘 다 그 자리(인라인)에서 하는 조작이라 한 라우트로 받는다.
   * 루트 이름은 모임 이름을 바꿔야 바뀌고, 루트는 옮길 수 없다 (services 가 막는다).
   */
  app.patch("/api/groups/:gid/folders/:fid", async (req) => {
    const user = await requireAuth(req);
    const { gid, fid } = gidFidParams.parse(req.params);
    await requireMember(user, gid);

    const body = z
      .object({ name: nameSchema.optional(), parentId: z.string().uuid().optional() })
      .safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");
    if (body.data.name === undefined && body.data.parentId === undefined) {
      throw badRequest("바꿀 값이 없습니다");
    }

    let folder = await folderOrThrow(gid, fid);
    // 이동을 먼저 한다. 이름만 바뀌고 이동이 400 으로 막히면 화면과 DB 가 어긋나기 때문이다.
    if (body.data.parentId !== undefined) folder = await moveFolder(gid, fid, body.data.parentId);
    if (body.data.name !== undefined) folder = await renameFolder(gid, fid, body.data.name);

    return { folder: folderView(folder, await sharedInMap(gid)) };
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
