/**
 * ══════════ 슬러그와 공유 토큰 ══════════
 *
 * ⚠ 공유 링크 토큰을 폴더 ID 에서 파생시키지 말 것.
 *   비공개로 되돌리면 그 링크는 즉시 죽어야 하고, 다시 공개하면 새 토큰이 나와야 한다.
 *   ID 에서 파생하면 예전에 뿌린 링크가 되살아난다.
 */

/** 한글을 살리고 나머지는 하이픈으로 접는다. "Day 1 · 성산" → "day-1-성산" */
export function slugify(s: string): string {
  const out = s
    .trim()
    .toLowerCase()
    .replace(/[·・]/g, "-")
    .replace(/[^\w가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "folder";
}

/**
 * 같은 부모 아래에서 슬러그가 겹치지 않게 만든다. "성산", "성산-2", "성산-3" …
 * 뷰어 URL 이 `/{groupId}/view/{slug}` 라 모임 안에서 유일해야 한다.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const root = slugify(base);
  if (!set.has(root)) return root;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${root}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
  throw new Error("슬러그를 만들 수 없습니다");
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * 추측 불가능한 공유 토큰. 기본 32자 = 192비트.
 * 프로토타입의 8자는 데모용이었다 — 그대로 쓰면 뷰어 링크가 브루트포스된다.
 */
export function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** 초대 코드. 사람이 URL 로 주고받으므로 조금 짧게. */
export const inviteCode = (): string => randomToken(24);

/** 뷰어 주소. 이미지도 이 도메인 안에서만 나간다 — Drive 링크를 절대 내보내지 않는다. */
export const viewerPath = (groupId: string, slug: string, token: string): string =>
  `/${groupId}/view/${slug}?t=${token}`;

/** 정산 공유 주소. 멤버가 열면 앱 정산 화면, 밖에서 열면 읽기 전용 뷰어. */
export const settleSharePath = (groupId: string, token: string): string =>
  `/${groupId}/settle/${token}`;

/** 초대 주소. 로그인 후 "○○ 모임에 참여하시겠습니까?" 로 이어진다. */
export const invitePath = (code: string): string => `/join?code=${code}`;

/** 초대 링크 유효 시간 — 발급 후 30분. 사용해도 만료되지 않고 시각 기준으로 죽는다. */
export const INVITE_TTL_MS = 30 * 60 * 1000;
