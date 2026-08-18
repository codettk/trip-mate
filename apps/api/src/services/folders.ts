/**
 * 폴더 서비스.
 *
 * 공유 규칙 (CLAUDE.md 확정):
 *  · 모임 멤버는 모든 폴더를 그대로 본다. 폴더별 권한 설정이 없다.
 *  · 모임 밖 사람은 공개된 그 폴더의 미디어만 보는 뷰어 전용 링크를 받는다.
 *    하위·다른 폴더 이동 불가, 업로드·삭제 불가.
 *  · 폴더마다 공개/비공개 토글이 있고 기본값은 비공개.
 *
 * ⚠ 공유 링크를 폴더 ID 에서 파생시키지 말 것.
 *   비공개로 되돌리면 링크가 즉시 죽어야 하고, 다시 공개하면 새 토큰이 나와야 한다.
 */

import { randomToken, uniqueSlug, type FolderNode } from "@tripmate/core";
import { db } from "../db/client.ts";
import { badRequest, notFound } from "../lib/http.ts";
import { storage } from "../storage/index.ts";

export interface FolderRow {
  id: string;
  group_id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  pub: boolean;
  share_token: string | null;
  drive_folder_id: string | null;
}

export async function rootFolder(groupId: string): Promise<FolderRow> {
  const row = await db
    .selectFrom("folders")
    .select(["id", "group_id", "parent_id", "name", "slug", "pub", "share_token", "drive_folder_id"])
    .where("group_id", "=", groupId)
    .where("parent_id", "is", null)
    .executeTakeFirst();
  if (!row) throw notFound("루트 폴더가 없습니다");
  return row;
}

export async function folderOrThrow(groupId: string, folderId: string): Promise<FolderRow> {
  const row = await db
    .selectFrom("folders")
    .select(["id", "group_id", "parent_id", "name", "slug", "pub", "share_token", "drive_folder_id"])
    .where("id", "=", folderId)
    .where("group_id", "=", groupId)
    .executeTakeFirst();
  if (!row) throw notFound("폴더를 찾을 수 없습니다");
  return row;
}

/** 모임의 전체 폴더 트리. 깊이 제한이 없으므로 한 번에 읽어 메모리에서 조립한다. */
export async function folderTree(groupId: string): Promise<FolderNode> {
  const rows = await db
    .selectFrom("folders")
    .select(["id", "parent_id", "name", "slug", "pub", "share_token"])
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

  const nodes = new Map<string, FolderNode>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      name: r.name,
      slug: r.slug,
      parentId: r.parent_id,
      pub: r.pub,
      token: r.share_token,
      photoCount: countBy.get(r.id) ?? 0,
      children: [],
    });
  }

  let root: FolderNode | null = null;
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
    .select(["id", "group_id", "parent_id", "name", "slug", "pub", "share_token", "drive_folder_id"])
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
      pub: false,
      share_token: null,
      drive_folder_id: driveId,
      created_by: args.userId,
    })
    .returning(["id", "group_id", "parent_id", "name", "slug", "pub", "share_token", "drive_folder_id"])
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
    .returning(["id", "group_id", "parent_id", "name", "slug", "pub", "share_token", "drive_folder_id"])
    .executeTakeFirstOrThrow();

  if (f.drive_folder_id) {
    const s = await storage();
    await s.renameFolder(f.drive_folder_id, name);
  }
  return updated;
}

/**
 * 공개/비공개 토글.
 * 공개할 때마다 새 토큰을 발급한다 — 예전에 뿌린 링크가 되살아나면 안 된다.
 */
export async function setFolderPublic(
  groupId: string,
  folderId: string,
  pub: boolean,
): Promise<FolderRow> {
  await folderOrThrow(groupId, folderId);
  return db
    .updateTable("folders")
    .set({ pub, share_token: pub ? randomToken() : null, updated_at: new Date() })
    .where("id", "=", folderId)
    .returning(["id", "group_id", "parent_id", "name", "slug", "pub", "share_token", "drive_folder_id"])
    .executeTakeFirstOrThrow();
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
