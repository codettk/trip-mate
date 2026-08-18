/**
 * 폴더 서비스.
 *
 * 공유 규칙 (CLAUDE.md 확정 + 2026-08-18 묶음 재설계):
 *  · 모임 멤버는 모든 폴더를 그대로 본다. 폴더별 권한 설정이 없다.
 *  · 모임 밖 사람은 **공유 묶음**에 담긴 폴더의 미디어만 보는 뷰어 전용 링크를 받는다.
 *  · 공유는 더 이상 폴더 행에 붙지 않는다 — `share_links` 가 정본이다(services/shares.ts).
 *    그래서 이 파일에는 pub / share_token 이 등장하지 않는다. 권한 규칙을 두 군데 두지 않는다.
 *
 * ⚠ 폴더를 옮길 때의 판정도 core 의 `canMoveFolder` 한 벌만 쓴다.
 *   자기 자손 밑으로 들어가면 트리가 고리가 되어 resolveShared 가 끝나지 않는다.
 */

import { canMoveFolder, uniqueSlug } from "@tripmate/core";
import { db } from "../db/client.ts";
import { badRequest, notFound } from "../lib/http.ts";
import { storage } from "../storage/index.ts";
import { groupFolders, sharedInMap } from "./shares.ts";

export interface FolderRow {
  id: string;
  group_id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  drive_folder_id: string | null;
}

/** 어디서 폴더를 읽든 같은 컬럼만 뽑는다 — 여기에 없는 값은 밖으로도 나가지 않는다. */
const FOLDER_COLUMNS = ["id", "group_id", "parent_id", "name", "slug", "drive_folder_id"] as const;

/**
 * 폴더 트리 노드.
 * `pub`/`token` 대신 `sharedIn` 이다 — 폴더 하나가 여러 묶음에 동시에 들어갈 수 있어서
 * 참·거짓으로는 "어느 링크로 나가는지"를 말할 수 없다.
 */
export interface FolderTreeNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  photoCount: number;
  /** 이 폴더를 담고 있는 묶음 id 들. 비어 있으면 밖으로 나가지 않는다 */
  sharedIn: string[];
  children: FolderTreeNode[];
}

export async function rootFolder(groupId: string): Promise<FolderRow> {
  const row = await db
    .selectFrom("folders")
    .select(FOLDER_COLUMNS)
    .where("group_id", "=", groupId)
    .where("parent_id", "is", null)
    .executeTakeFirst();
  if (!row) throw notFound("루트 폴더가 없습니다");
  return row;
}

export async function folderOrThrow(groupId: string, folderId: string): Promise<FolderRow> {
  const row = await db
    .selectFrom("folders")
    .select(FOLDER_COLUMNS)
    .where("id", "=", folderId)
    .where("group_id", "=", groupId)
    .executeTakeFirst();
  if (!row) throw notFound("폴더를 찾을 수 없습니다");
  return row;
}

/** 모임의 전체 폴더 트리. 깊이 제한이 없으므로 한 번에 읽어 메모리에서 조립한다. */
export async function folderTree(groupId: string): Promise<FolderTreeNode> {
  const rows = await db
    .selectFrom("folders")
    .select(["id", "parent_id", "name", "slug"])
    .where("group_id", "=", groupId)
    .orderBy("created_at", "asc")
    .execute();

  const counts = await db
    .selectFrom("photos")
    .select(["folder_id", (eb) => eb.fn.countAll<string>().as("c")])
    .where("group_id", "=", groupId)
    .groupBy("folder_id")
    .execute();
  const countBy = new Map(counts.map((c) => [c.folder_id, Number(c.c)]));
  const shared = await sharedInMap(groupId);

  const nodes = new Map<string, FolderTreeNode>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      name: r.name,
      slug: r.slug,
      parentId: r.parent_id,
      photoCount: countBy.get(r.id) ?? 0,
      sharedIn: shared.get(r.id) ?? [],
      children: [],
    });
  }

  let root: FolderTreeNode | null = null;
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    if (r.parent_id === null) root = node;
    else nodes.get(r.parent_id)?.children.push(node);
  }
  if (!root) throw notFound("루트 폴더가 없습니다");
  return root;
}

/** 그 폴더에서 루트까지의 경로. 브레드크럼에 쓴다. */
export async function breadcrumb(groupId: string, folderId: string): Promise<FolderRow[]> {
  const all = await db
    .selectFrom("folders")
    .select(FOLDER_COLUMNS)
    .where("group_id", "=", groupId)
    .execute();
  const by = new Map(all.map((f) => [f.id, f]));
  const out: FolderRow[] = [];
  let cur = by.get(folderId);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent_id ? by.get(cur.parent_id) : undefined;
  }
  if (!out.length) throw notFound("폴더를 찾을 수 없습니다");
  return out;
}

export async function createFolder(args: {
  groupId: string;
  parentId: string;
  name: string;
  userId: string;
}): Promise<FolderRow> {
  const parent = await folderOrThrow(args.groupId, args.parentId);

  const taken = await db
    .selectFrom("folders")
    .select("slug")
    .where("group_id", "=", args.groupId)
    .execute();
  const slug = uniqueSlug(args.name, taken.map((t) => t.slug));

  let driveId: string | null = null;
  if (parent.drive_folder_id) {
    const s = await storage();
    driveId = await s.createFolder(args.name, parent.drive_folder_id);
  }

  return db
    .insertInto("folders")
    .values({
      group_id: args.groupId,
      parent_id: parent.id,
      name: args.name,
      slug,
      drive_folder_id: driveId,
      created_by: args.userId,
    })
    .returning(FOLDER_COLUMNS)
    .executeTakeFirstOrThrow();
}

export async function renameFolder(groupId: string, folderId: string, name: string): Promise<FolderRow> {
  const f = await folderOrThrow(groupId, folderId);
  if (f.parent_id === null) {
    throw badRequest("루트 폴더 이름은 모임 이름을 바꿔야 바뀝니다");
  }

  const taken = await db
    .selectFrom("folders")
    .select("slug")
    .where("group_id", "=", groupId)
    .where("id", "!=", folderId)
    .execute();
  const slug = uniqueSlug(name, taken.map((t) => t.slug));

  const updated = await db
    .updateTable("folders")
    .set({ name, slug, updated_at: new Date() })
    .where("id", "=", folderId)
    .returning(FOLDER_COLUMNS)
    .executeTakeFirstOrThrow();

  if (f.drive_folder_id) {
    const s = await storage();
    await s.renameFolder(f.drive_folder_id, name);
  }
  return updated;
}

/**
 * 다른 폴더 밑으로 옮긴다.
 *
 * 판정은 core 의 `canMoveFolder` 가 한다 — 자기 자신·자손 밑 금지, 루트 이동 금지.
 * 사유를 그대로 400 으로 올려 화면이 같은 문장을 쓰게 한다(규칙이 두 벌이 되지 않도록).
 *
 * ⚠ 옮기면 공유 범위가 따라 움직인다. `includeDescendants` 묶음 아래로 들어간 폴더는
 *   그 순간부터 밖으로 나간다 — 화면이 이동 전에 경고해야 하고, 서버는 막지 않는다
 *   (멤버는 모든 폴더를 그대로 보는 사이라 정리 자체를 금지할 이유가 없다).
 */
export async function moveFolder(
  groupId: string,
  folderId: string,
  parentId: string,
): Promise<FolderRow> {
  const f = await folderOrThrow(groupId, folderId);
  const target = await folderOrThrow(groupId, parentId);

  const tree = (await groupFolders(groupId)).map((x) => ({ id: x.id, parentId: x.parent_id }));
  const verdict = canMoveFolder(folderId, parentId, tree);
  if (!verdict.ok) throw badRequest(verdict.reason ?? "옮길 수 없습니다");

  if (f.parent_id === parentId) return f; // 이미 그 자리다. 저장소를 건드릴 이유가 없다

  const updated = await db
    .updateTable("folders")
    .set({ parent_id: parentId, updated_at: new Date() })
    .where("id", "=", folderId)
    .returning(FOLDER_COLUMNS)
    .executeTakeFirstOrThrow();

  // 저장소 폴더는 아직 안 만들어졌을 수 있다(첫 업로드 때 생긴다). 둘 다 있을 때만 따라 옮긴다.
  if (f.drive_folder_id && target.drive_folder_id) {
    const s = await storage();
    await s.moveFolder(f.drive_folder_id, target.drive_folder_id);
  }
  return updated;
}

/** 폴더와 그 아래 전부를 지운다. 루트는 지울 수 없다. */
export async function deleteFolder(groupId: string, folderId: string): Promise<void> {
  const f = await folderOrThrow(groupId, folderId);
  if (f.parent_id === null) throw badRequest("루트 폴더는 삭제할 수 없습니다");

  const s = await storage();
  const descendants = await descendantIds(groupId, folderId);
  const files = await db
    .selectFrom("photos")
    .select("storage_key")
    .where("folder_id", "in", descendants)
    .execute();

  await db.deleteFrom("folders").where("id", "=", folderId).execute(); // ON DELETE CASCADE

  for (const file of files) {
    await s.deleteFile(file.storage_key).catch(() => undefined);
  }
  if (f.drive_folder_id) await s.deleteFolder(f.drive_folder_id).catch(() => undefined);
}

export async function descendantIds(groupId: string, folderId: string): Promise<string[]> {
  const all = await db
    .selectFrom("folders")
    .select(["id", "parent_id"])
    .where("group_id", "=", groupId)
    .execute();
  const out = [folderId];
  let added = true;
  while (added) {
    added = false;
    for (const f of all) {
      if (f.parent_id && out.includes(f.parent_id) && !out.includes(f.id)) {
        out.push(f.id);
        added = true;
      }
    }
  }
  return out;
}
