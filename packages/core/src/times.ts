/**
 * ══════════ 시각 ══════════
 *
 * 항목은 시작 시각과 (선택인) 종료 시각을 갖는다. 숙소는 거기에 더해
 * 체크인·체크아웃 시각을 갖는데, **날짜는 `check_in`/`check_out` 이 들고 있고
 * 여기 있는 건 시각뿐이다.** 날짜 계산(`staysOn`)이 전부 그 date 컬럼에 걸려 있어서
 * 두 개를 한 값으로 합치면 일차·숙박 로직이 통째로 흔들린다.
 *
 * 서버와 브라우저가 같은 함수를 쓴다 — 폼에서 "다음 날 01:30" 이라고 보여 준 것과
 * 저장된 값의 해석이 달라지면 안 되기 때문이다. 정산에서 `previewSplit` 을
 * 한 벌만 두는 것과 같은 이유다.
 */

/** `HH:MM`. 24시간제이고 앞자리 0 을 채운다. */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 빈 문자열은 "시각 없음"이라 통과시킨다. 시간은 원래 비워 둘 수 있는 값이다. */
export function isTime(s: string): boolean {
  return s === "" || HHMM.test(s);
}

/** `"08:20"` → 500 (자정으로부터 분). 형식이 아니면 null. */
export function minutesOf(s: string): number | null {
  const m = HHMM.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 500 → `"08:20"`. 24시간을 넘으면 넘긴 만큼만 남긴다. */
export function timeOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * 종료가 시작보다 이르면 **익일**이다.
 *
 * 야간 버스나 밤 비행기(`23:00 → 01:30`)를 위해서다. 도착 날짜 컬럼을 따로 두는 대신
 * 이 규칙 하나로 덮는다 — 하루를 넘기는 일정은 있어도 이틀을 넘기는 일정은 없다.
 */
export function crossesMidnight(start: string, end: string): boolean {
  const a = minutesOf(start);
  const b = minutesOf(end);
  if (a === null || b === null) return false;
  return b < a;
}

/**
 * 걸린 시간(분). 익일로 넘어가면 그만큼 더해서 센다.
 * 둘 중 하나라도 비어 있으면 null — "모른다"와 "0분"은 다르다.
 */
export function durationMinutes(start: string, end: string): number | null {
  const a = minutesOf(start);
  const b = minutesOf(end);
  if (a === null || b === null) return null;
  return b < a ? 1440 - a + b : b - a;
}

/** `"1시간 30분"` · `"45분"` · `"2시간"`. 0 분이면 빈 문자열. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

/**
 * 카드에 찍는 시간 범위.
 *   `"09:30"`             종료가 없을 때
 *   `"09:30 – 11:00"`     같은 날
 *   `"23:00 – 01:30"`     익일 (`crossesMidnight` 로 배지를 따로 붙인다)
 */
export function formatRange(start: string, end: string): string {
  if (!start) return end ? end : "";
  if (!end) return start;
  return `${start} – ${end}`;
}

/**
 * 숙소가 그 날짜에 며칠째인가. 체크인한 날이 1박째다.
 * 칩에 "숙박 중 · 3박째" 로 찍힌다 — 여러 날에 걸친 숙소가 매일 똑같아 보이면
 * 지금이 며칠째인지 알 수 없다.
 *
 * 체크아웃하는 날은 묵지 않으므로 null 을 준다.
 */
export function nightIndex(date: string, checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  if (date < checkIn || date >= checkOut) return null;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}
