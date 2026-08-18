/**
 * ══════════ 공유 묶음 서비스 ══════════
 *
 * 공유의 정본은 `share_links` 한 곳이다. 폴더 행에는 공개 여부가 더 이상 없다 —
 * 권한 규칙이 두 군데 있으면 언젠가 한쪽만 고쳐서 새어 나간다(003 마이그레이션).
 *
 * ⚠ 폴더 집합을 푸는 계산은 **core 의 `resolveShared` 하나뿐이다.**
 *   브라우저의 공유 모달이 "3개 폴더가 나갑니다" 라고 세는 것과 서버의 권한 검사가
 *   1개라도 다르면 그게 유출이다. 여기서 SQL 로 재귀를 다시 쓰지 않는 이유가 그것이다
 *   (모임당 폴더는 많아야 수십 개라 통째로 읽어 core 에 넘기는 편이 싸고 안전하다).
 *
 * ⚠ 토큰은 묶음 id·폴더 id 에서 파생시키지 않는다. 중지했다 다시 공유하면 새 난수를 뽑아
 *   예전에 뿌린 링크가 되살아나지 않게 한다.
 */

import { timingSafeEqual } from "node:crypto";
import { randomToken, resolveShared, type ShareEntry } from "@tripmate/core";
import { db } from "../db/client.ts";
import { badRequest, notFound } from "../lib/http.ts";

/** 트리를 푸는 데 필요한 폴더 정보. drive_folder_id 는 여기에 들어오지 않는다. */
export interface FolderTreeRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
}

export interface ShareLinkFull {
  id: string;
  group_id: string;
  label: string;
  token: string;
  created_at: Date;
  entries: ShareEntry[];
}

/**
 * 토큰 비교는 길이·내용을 시간차로 흘리지 않게 한다.
 * (photos.ts 의 미디어 접근 검사도 이 함수를 쓴다 — 비교 규칙을 두 벌 두지 않는다.)
 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 모임의 폴더 전부. resolveShared / canMoveFolder 가 이 목록을 받는다. */
export async function groupFolders(groupId: string): Promise<FolderTreeRow[]> {
  return db
    .selectFrom("folders")
    .select(["id", "parent_id", "name", "slug"])
    .where("group_id", "=", groupId)
    .orderBy("created_at", "asc")
    .execute();
}

async function entriesOf(linkIds: string[]): Promise<Map<string, ShareEntry[]>> {
  const out = new Map<string, ShareEntry[]>();
  if (!linkIds.length) return out;
  const rows = await db
    .selectFrom("share_link_folders")
    .select(["link_id", "folder_id", "include_descendants"])
    .where("link_id", "in", linkIds)
    .execute();
  for (const r of rows) {
    const list = out.get(r.link_id);
    const e: ShareEntry = { folderId: r.folder_id, includeDescendants: r.include_descendants };
    if (list) list.push(e);
    else out.set(r.link_id, [e]);
  }
  return out;
}

export async function loadShares(groupId: string): Promise<ShareLinkFull[]> {
  const links = await db
    .selectFrom("share_links")
    .select(["id", "group_id", "label", "token", "created_at"])
    .where("group_id", "=", groupId)
    .orderBy("created_at", "asc")
    .execute();
  const byLink = await entriesOf(links.map((l) => l.id));
  return links.map((l) => ({ ...l, entries: byLink.get(l.id) ?? [] }));
}

export async function loadShare(groupId: string, linkId: string): Promise<ShareLinkFull> {
  const link = await db
    .selectFrom("share_links")
    .select(["id", "group_id", "label", "token", "created_at"])
    .where("id", "=", linkId)
    .where("group_id", "=", groupId)
    .executeTakeFirst();
  if (!link) throw notFound("공유 묶음을 찾을 수 없습니다");
  const byLink = await entriesOf([link.id]);
  return { ...link, entries: byLink.get(link.id) ?? [] };
}

/**
 * 토큰으로 묶음을 찾는다. 뷰어와 미디어 접근 검사가 둘 다 여기를 지난다.
 *
 * 토큰을 WHERE 절에 바로 넣지 않고 모임의 묶음을 읽어 와 `safeEqual` 로 비교한다 —
 * 묶음은 모임당 몇 개뿐이고, 비교 시간이 토큰 내용에 따라 달라지지 않아야 한다.
 * 삭제된 모임의 링크는 열리지 않는다.
 */
export async function findShareByToken(groupId: string, token: string): Promise<ShareLinkFull | null> {
  if (!token) return null;
  const alive = await db
    .selectFrom("groups")
    .select("id")
    .where("id", "=", groupId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!alive) return null;

  const links = await loadShares(groupId);
  return links.find((l) => safeEqual(l.token, token)) ?? null;
}

/** 이 묶음이 실제로 내보내는 폴더 id 전부. 계산은 core 한 벌뿐이다. */
export async function sharedIdsOf(link: ShareLinkFull): Promise<Set<string>> {
  const folders = await groupFolders(link.group_id);
  return resolveShared(
    link.entries,
    folders.map((f) => ({ id: f.id, parentId: f.parent_id })),
  );
}

/**
 * 폴더 → 그 폴더를 담고 있는 묶음 id 목록.
 * 폴더 화면이 "공유 중" 배지를 그리는 데 쓴다 — `includeDescendants` 로 딸려 나가는 폴더도 잡힌다.
 */
export async function sharedInMap(groupId: string): Promise<Map<string, string[]>> {
  const [links, folders] = await Promise.all([loadShares(groupId), groupFolders(groupId)]);
  const tree = folders.map((f) => ({ id: f.id, parentId: f.parent_id }));

  const out = new Map<string, string[]>();
  for (const l of links) {
    for (const fid of resolveShared(l.entries, tree)) {
      const list = out.get(fid);
      if (list) list.push(l.id);
      else out.set(fid, [l.id]);
    }
  }
  return out;
}

/** 묶음에 담긴 폴더들의 사진 수. 목록 화면이 "몇 장이 나가는가"를 보여 준다. */
export async function photoCountOf(folderIds: Set<string>): Promise<number> {
  if (!folderIds.size) return 0;
  const row = await db
    .selectFrom("photos")
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .where("folder_id", "in", [...folderIds])
    .executeTakeFirst();
  return Number(row?.c ?? 0);
}

/**
 * 들어온 entries 를 정리한다.
 *  · 같은 모임의 폴더가 아니면 거부 — 남의 모임 폴더를 담아 내보낼 수 없다
 *  · 중복 folderId 는 하나로 합친다. **플래그가 어긋나면 좁은 쪽(false)을 택한다** —
 *    넓은 쪽을 고르면 공유 모달이 보여 준 것보다 많이 나간다
 *  · 빈 배열도 허용한다 (아무것도 공유하지 않는 묶음)
 */
export async function normalizeEntries(groupId: string, entries: ShareEntry[]): Promise<ShareEntry[]> {
  const merged = new Map<string, boolean>();
  for (const e of entries) {
    const prev = merged.get(e.folderId);
    merged.set(e.folderId, prev === undefined ? e.includeDescendants : prev && e.includeDescendants);
  }
  if (!merged.size) return [];

  const known = await db
    .selectFrom("folders")
    .select("id")
    .where("group_id", "=", groupId)
    .where("id", "in", [...merged.keys()])
    .execute();
  const knownIds = new Set(known.map((k) => k.id));
  for (const id of merged.keys()) {
    if (!knownIds.has(id)) throw badRequest("이 모임의 폴더가 아닙니다");
  }
  return [...merged].map(([folderId, includeDescendants]) => ({ folderId, includeDescendants }));
}

async function writeEntries(linkId: string, entries: ShareEntry[]): Promise<void> {
  await db.deleteFrom("share_link_folders").where("link_id", "=", linkId).execute();
  if (!entries.length) return;
  await db
    .insertInto("share_link_folders")
    .values(
      entries.map((e) => ({
        link_id: linkId,
        folder_id: e.folderId,
        include_descendants: e.includeDescendants,
      })),
    )
    .execute();
}

export async function createShare(args: {
  groupId: string;
  label: string;
  entries: ShareEntry[];
  userId: string;
}): Promise<ShareLinkFull> {
  const entries = await normalizeEntries(args.groupId, args.entries);
  const link = await db
    .insertInto("share_links")
    .values({
      group_id: args.groupId,
      label: args.label,
      token: randomToken(), // 난수. 묶음 id 에서 파생시키지 않는다
      created_by: args.userId,
    })
    .returning(["id", "group_id", "label", "token", "created_at"])
    .executeTakeFirstOrThrow();

  await writeEntries(link.id, entries);
  return { ...link, entries };
}

/**
 * 이름·구성 수정. **토큰은 그대로 둔다** — 묶음에서 폴더를 빼면 그 폴더만 즉시 안 보이고
 * 이미 뿌린 링크는 살아 있어야 한다(사용자가 고른 동작). 링크를 끊고 싶으면 rotate 나 삭제다.
 */
export async function updateShare(
  groupId: string,
  linkId: string,
  patch: { label?: string; entries?: ShareEntry[] },
): Promise<ShareLinkFull> {
  const cur = await loadShare(groupId, linkId);
  const entries = patch.entries ? await normalizeEntries(groupId, patch.entries) : cur.entries;

  const updated = await db
    .updateTable("share_links")
    .set({ label: patch.label ?? cur.label, updated_at: new Date() })
    .where("id", "=", linkId)
    .returning(["id", "group_id", "label", "token", "created_at"])
    .executeTakeFirstOrThrow();

  if (patch.entries) await writeEntries(linkId, entries);
  return { ...updated, entries };
}

/** 중지. 행을 지우므로 링크는 그 자리에서 죽는다 (share_link_folders 는 CASCADE). */
export async function deleteShare(groupId: string, linkId: string): Promise<void> {
  await loadShare(groupId, linkId);
  await db.deleteFrom("share_links").where("id", "=", linkId).execute();
}

/** 토큰 재발급. 뿌린 링크를 끊고 싶을 때. 옛 토큰은 이 순간 죽고 되살아나지 않는다. */
export async function rotateShare(groupId: string, linkId: string): Promise<ShareLinkFull> {
  const cur = await loadShare(groupId, linkId);
  const updated = await db
    .updateTable("share_links")
    .set({ token: randomToken(), updated_at: new Date() })
    .where("id", "=", linkId)
    .returning(["id", "group_id", "label", "token", "created_at"])
    .executeTakeFirstOrThrow();
  return { ...updated, entries: cur.entries };
}
