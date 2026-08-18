/**
 * ══════════ 일차 ══════════
 *
 * 일차(Day)는 모임의 시작일~종료일에서 자동 생성된다.
 * 사용자가 일차를 직접 추가·삭제하지 않는다 — 기간을 바꾸면 일차가 따라 바뀐다.
 *
 * 날짜는 전부 `YYYY-MM-DD` 문자열로 다룬다. Date 객체를 돌리면 타임존 때문에 하루가 밀린다.
 */

const DOW = ["일", "월", "화", "수", "목", "금", "토"] as const;

export interface DaySpec {
  /** 1-base 일차 번호 */
  n: number;
  /** YYYY-MM-DD */
  date: string;
  /** 요일 한 글자 */
  dow: string;
  /** 화면 표기용 짧은 날짜 "09.12" */
  short: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-09-12" → UTC 자정 밀리초. 타임존 영향을 받지 않는다. */
export function parseDate(iso: string): number {
  if (!ISO.test(iso)) throw new Error(`날짜 형식이 YYYY-MM-DD 가 아닙니다: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  const back = formatDate(t);
  if (back !== iso) throw new Error(`존재하지 않는 날짜입니다: ${iso}`);
  return t;
}

/** UTC 밀리초 → "YYYY-MM-DD" */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "2026-09-12" → "09.12" */
export const shortDate = (iso: string): string => iso.slice(5).replace("-", ".");

/** "2026-09-12" → "토" */
export const dowOf = (iso: string): string => DOW[new Date(parseDate(iso)).getUTCDay()]!;

export const addDays = (iso: string, n: number): string =>
  formatDate(parseDate(iso) + n * 86_400_000);

/** 두 날짜 사이의 일수. 같은 날이면 0 */
export const daysBetween = (a: string, b: string): number =>
  Math.round((parseDate(b) - parseDate(a)) / 86_400_000);

/**
 * 시작일~종료일에서 일차 목록을 만든다.
 * 종료일을 포함하므로 09.12~09.16 은 5일차(4박 5일)다.
 */
export function buildDays(start: string, end: string): DaySpec[] {
  const span = daysBetween(start, end);
  if (span < 0) throw new Error("종료일이 시작일보다 빠릅니다");
  if (span > 364) throw new Error("여행 기간은 365일을 넘을 수 없습니다");

  const out: DaySpec[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(start, i);
    out.push({ n: i + 1, date, dow: dowOf(date), short: shortDate(date) });
  }
  return out;
}

/** "4박 5일" 같은 표기. 당일치기는 "당일". */
export function tripLength(start: string, end: string): string {
  const nights = daysBetween(start, end);
  if (nights <= 0) return "당일";
  return `${nights}박 ${nights + 1}일`;
}

/**
 * 숙소의 박 수. 체크인~체크아웃 날짜 차이다.
 * 비용은 체크인 날 한 번만 정산에 들어가고 박 수로 쪼개지 않는다.
 */
export function nightsOf(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  return Math.max(0, daysBetween(checkIn, checkOut));
}

/**
 * 그 날짜에 묵고 있는 숙소들.
 * 체크아웃하는 곳과 새로 체크인하는 곳이 겹치는 날에는 2개가 나온다.
 */
export function staysOn<T extends { cat: string; checkIn: string | null; checkOut: string | null }>(
  items: T[],
  date: string,
): T[] {
  return items.filter(
    (i) =>
      i.cat === "stay" &&
      i.checkIn !== null &&
      i.checkOut !== null &&
      i.checkIn <= date &&
      date <= i.checkOut,
  );
}

/** 그 숙소가 이 날짜에 어떤 상태인가 */
export type StayPhase = "in" | "mid" | "out";

export function stayPhase(
  date: string,
  checkIn: string | null,
  checkOut: string | null,
): StayPhase | null {
  if (!checkIn || !checkOut) return null;
  if (date === checkIn) return "in";
  if (date === checkOut) return "out";
  if (checkIn < date && date < checkOut) return "mid";
  return null;
}

export const STAY_PHASE_LABEL: Record<StayPhase, string> = {
  in: "체크인",
  mid: "숙박 중",
  out: "체크아웃",
};
