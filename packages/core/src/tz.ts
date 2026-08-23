/**
 * ══════════ 시간대 ══════════
 *
 * **이 서비스의 시각은 전부 한국 시간(KST)으로 보여 준다.** 한 곳에서만 정한다.
 *
 * 왜 규칙이 필요한가 — 두 군데서 어긋났다.
 *
 * ① **화면**이 `Date#getHours()` 를 썼다. 그러면 **보는 사람 기기의 시간대**를 따른다.
 *    같은 사진이 서울에서는 19:42, 해외에서 열면 다른 숫자로 보인다. 같이 보는 앨범인데
 *    사람마다 다른 시각이 적히면 "언제 찍은 거야"를 이야기할 수 없다.
 *
 * ② **서버**가 EXIF 촬영 시각을 `new Date("2026:08:22 19:42:44")` 로 읽었다.
 *    EXIF 촬영 시각에는 **시간대가 없다** — 카메라가 가리키던 벽시계 숫자일 뿐이다.
 *    그걸 그냥 Date 로 만들면 **그 코드가 돌아가는 기계의 시간대**로 해석된다.
 *    개발 PC(KST)와 Render(UTC)가 같은 사진을 9시간 다르게 저장했다.
 *
 * 그래서 시간대를 **기계에서 떼어내** 여기 상수로 박는다.
 * KST 는 서머타임이 없어 offset 이 항상 +09:00 이다 — 계산이 단순해진다.
 * (일본도 +09:00 이라 후쿠오카에서 찍은 사진의 벽시계 숫자가 그대로 살아난다.)
 */

/** 한국 표준시. 서머타임이 없어 항상 고정이다. */
export const KST_OFFSET = "+09:00";
export const KST_ZONE = "Asia/Seoul";

/** 고정 오프셋이라 분 단위로도 쓴다 (9시간). */
const KST_MINUTES = 9 * 60;

/** ISO 문자열이나 Date 를 밀리초로. 못 읽으면 null — 화면에서 "Invalid Date" 가 나오면 안 된다. */
function ms(v: string | number | Date | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 한국 시간으로 옮긴 뒤 UTC 게터로 읽기 위한 Date. **표시에만 쓴다.** */
function shifted(t: number): Date {
  return new Date(t + KST_MINUTES * 60_000);
}

const p2 = (n: number): string => String(n).padStart(2, "0");

/** 한국 시간 "08.22 19:42". 사진 목록·배지처럼 연도가 필요 없는 자리에 쓴다. */
export function kstStamp(v: string | number | Date | null | undefined): string {
  const t = ms(v);
  if (t === null) return "";
  const d = shifted(t);
  return `${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** 한국 시간 "2026.08.22 19:42". 문서 수정 시각처럼 연도까지 필요한 자리에 쓴다. */
export function kstDateTime(v: string | number | Date | null | undefined): string {
  const t = ms(v);
  if (t === null) return "";
  const d = shifted(t);
  return `${d.getUTCFullYear()}.${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** 한국 시간 기준 `YYYY-MM-DD`. 일차를 찾을 때처럼 날짜만 필요한 자리에 쓴다. */
export function kstDate(v: string | number | Date | null | undefined): string {
  const t = ms(v);
  if (t === null) return "";
  const d = shifted(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** `<input type="datetime-local">` 이 쓰는 모양(`2026-08-22T19:42`)으로. **한국 시간이다.** */
export function toKstInput(v: string | number | Date | null | undefined): string {
  const t = ms(v);
  if (t === null) return "";
  const d = shifted(t);
  return `${kstDate(t)}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/**
 * `datetime-local` 이 돌려준 값을 **한국 시간으로 읽어** 그 순간의 ISO 로.
 * 브라우저 기기가 어느 시간대에 있든 같은 결과가 나온다 — 그게 이 함수의 존재 이유다.
 */
export function fromKstInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const t = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${KST_OFFSET}`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** EXIF 가 주는 시간대 표기 (`+09:00`). 없거나 모양이 다르면 null. */
function exifOffset(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return /^[+-]\d{2}:\d{2}$/.test(v) ? v : null;
}

/**
 * EXIF 촬영 시각(`"2026:08:22 19:42:44"`)을 실제 순간으로 바꾼다.
 *
 * **EXIF 에는 시간대가 없다.** 카메라가 가리키던 벽시계 숫자뿐이다.
 * 그래서 `new Date(문자열)` 로 만들면 **그 코드가 돌아가는 기계의 시간대**로 해석되고,
 * 서버가 UTC 면 9시간 밀린 값이 저장된다. 기계에 맡기지 않고 여기서 정한다:
 *
 *   · `OffsetTimeOriginal` 같은 시간대 표기가 있으면 **그것을 믿는다** (진짜 순간을 안다).
 *   · 없으면 **한국 시간으로 친다.** 그러면 화면(한국 시간)에 카메라가 보여 준 숫자가
 *     그대로 되돌아온다. 일본도 +09:00 이라 이 여행에서는 어느 쪽이든 같다.
 */
export function exifInstant(raw: unknown, offset?: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== "string") return null;

  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  if (!m) return null;

  const off = exifOffset(offset) ?? KST_OFFSET;
  const t = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${off}`);
  return Number.isNaN(t.getTime()) ? null : t;
}
