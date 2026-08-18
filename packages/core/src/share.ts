/**
 * ══════════ 공유 묶음 ══════════
 *
 * 공유는 폴더가 아니라 **묶음**에 붙는다. 한 모임에 용도별로 여러 개를 두고,
 * 묶음마다 포함할 폴더를 골라 담는다. 폴더 하나가 여러 묶음에 동시에 들어갈 수 있다.
 *
 * 서버(권한 검사)와 브라우저(공유 모달의 미리보기)가 **같은 함수로 폴더 집합을 푼다.**
 * 모달이 "3개 폴더가 나갑니다" 라고 했는데 실제로 5개가 나가면 그게 유출이다.
 *
 * ⚠ 밖으로 나가는 것은 이 집합에 속한 폴더의 **미디어뿐이다.**
 *   문서·정산·일정은 묶음으로도 나가지 않는다.
 */

/** 묶음에 담긴 한 줄. `includeDescendants` 면 그 아래 전부가 따라 나간다. */
export interface ShareEntry {
  folderId: string;
  includeDescendants: boolean;
}

/** 폴더 트리를 푸는 데 필요한 최소한의 모양. */
export interface ShareFolder {
  id: string;
  parentId: string | null;
}

/**
 * 묶음이 실제로 내보내는 폴더 id 전부.
 *
 * `includeDescendants` 인 줄은 그 아래 **모든 깊이**를 끌고 온다 — 하위 폴더에
 * 깊이 제한이 없기 때문이다. 나중에 새로 만든 폴더도 자동으로 들어오는데,
 * 그건 사용자가 고른 동작이고 화면이 배지로 알린다.
 *
 * 트리에 없는 폴더 id 는 조용히 버린다 (지워진 폴더가 묶음에 남아 있는 경우).
 */
export function resolveShared(entries: ShareEntry[], folders: ShareFolder[]): Set<string> {
  const known = new Set(folders.map((f) => f.id));

  // 부모 → 자식. 깊이가 얼마든 한 번의 순회로 내려간다.
  const children = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId === null) continue;
    const list = children.get(f.parentId);
    if (list) list.push(f.id);
    else children.set(f.parentId, [f.id]);
  }

  const out = new Set<string>();
  for (const e of entries) {
    if (!known.has(e.folderId)) continue;
    out.add(e.folderId);
    if (!e.includeDescendants) continue;

    // 너비 우선. 순환은 만들 수 없는 구조지만(부모 변경 때 막는다) 방어적으로 seen 을 둔다.
    const queue = [e.folderId];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const c of children.get(cur) ?? []) {
        if (out.has(c)) continue;
        out.add(c);
        queue.push(c);
      }
    }
  }
  return out;
}

/**
 * 이 폴더가 묶음에 **직접** 담겨 있지 않고 `includeDescendants` 때문에 딸려 나가는가.
 * 화면에서 "자동 포함" 배지를 붙이는 데 쓴다 — 모르고 새는 경로가 없어야 한다.
 */
export function isAutoIncluded(folderId: string, entries: ShareEntry[]): boolean {
  return !entries.some((e) => e.folderId === folderId);
}

/**
 * 폴더를 다른 폴더 밑으로 옮겨도 되는가.
 *
 * 자기 자신이나 자기 자손 밑으로 넣으면 트리가 고리가 되어 탐색이 끝나지 않는다.
 * 루트는 옮길 수 없다 — 루트 이름은 모임 제목이고 모임당 하나뿐이기 때문이다.
 */
export function canMoveFolder(
  folderId: string,
  targetParentId: string,
  folders: ShareFolder[],
): { ok: boolean; reason?: string } {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const self = byId.get(folderId);
  if (!self) return { ok: false, reason: "폴더를 찾을 수 없습니다" };
  if (self.parentId === null) return { ok: false, reason: "최상위 폴더는 옮길 수 없습니다" };
  if (!byId.has(targetParentId)) return { ok: false, reason: "옮길 위치를 찾을 수 없습니다" };
  if (folderId === targetParentId) return { ok: false, reason: "자기 자신 안으로는 옮길 수 없습니다" };

  // 목표 폴더에서 위로 거슬러 올라가다 자기 자신을 만나면 자손이다.
  let cur: string | null = targetParentId;
  const seen = new Set<string>();
  while (cur !== null && !seen.has(cur)) {
    if (cur === folderId) return { ok: false, reason: "하위 폴더 안으로는 옮길 수 없습니다" };
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return { ok: true };
}

/** 공유 뷰어 주소. 토큰이 곧 링크다 — 폴더 슬러그에서 파생시키지 않는다. */
export const sharePath = (groupId: string, token: string): string => `/${groupId}/view/${token}`;

/** 묶음 안에서 폴더를 열었을 때의 주소. 묶음 밖 폴더는 여기로도 열리지 않는다. */
export const sharedFolderPath = (groupId: string, token: string, slug: string): string =>
  `/${groupId}/view/${token}/${slug}`;
