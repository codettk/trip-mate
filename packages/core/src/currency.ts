/**
 * ══════════ 통화 ══════════
 *
 * 지출은 결제한 통화 그대로 입력하고, 그 항목이 속한 "일자의 최종(마감) 환율"로 원화 환산한다.
 * 정산 계산과 이체 금액은 전부 원화 정수다. 외화는 표시용일 뿐이다.
 * 소수점은 외화 입력에만 허용하고, 환산 결과와 정산 금액에는 절대 나오지 않는다.
 */

export interface CurrencyInfo {
  code: string;
  sym: string;
  name: string;
  /** 입력 시 허용 소수 자릿수. KRW/JPY/VND 는 0 */
  dec: number;
  /** 금액 입력 스테퍼 단위 */
  step: number;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  KRW: { code: "KRW", sym: "₩", name: "대한민국 원", dec: 0, step: 1000 },
  USD: { code: "USD", sym: "$", name: "미국 달러", dec: 2, step: 1 },
  JPY: { code: "JPY", sym: "¥", name: "일본 엔", dec: 0, step: 100 },
  VND: { code: "VND", sym: "₫", name: "베트남 동", dec: 0, step: 10000 },
  EUR: { code: "EUR", sym: "€", name: "유로", dec: 2, step: 1 },
  THB: { code: "THB", sym: "฿", name: "태국 바트", dec: 0, step: 10 },
  TWD: { code: "TWD", sym: "NT$", name: "대만 달러", dec: 0, step: 10 },
  PHP: { code: "PHP", sym: "₱", name: "필리핀 페소", dec: 0, step: 10 },
  CNY: { code: "CNY", sym: "元", name: "중국 위안", dec: 2, step: 10 },
  HKD: { code: "HKD", sym: "HK$", name: "홍콩 달러", dec: 2, step: 10 },
  SGD: { code: "SGD", sym: "S$", name: "싱가포르 달러", dec: 2, step: 1 },
  AUD: { code: "AUD", sym: "A$", name: "호주 달러", dec: 2, step: 1 },
  GBP: { code: "GBP", sym: "£", name: "영국 파운드", dec: 2, step: 1 },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);

export const isCurrency = (code: string): boolean => code in CURRENCIES;

export const currencyOf = (code: string): CurrencyInfo =>
  CURRENCIES[code] ?? { code, sym: code, name: code, dec: 2, step: 1 };

/**
 * 1 외화 = ? 원 (기준 환율).
 * 실제 서비스는 fx_rates 테이블의 그날 마감 환율을 쓴다. 이건 그 표가 비었을 때의 폴백이다.
 */
export const RATE_BASE: Record<string, number> = {
  KRW: 1,
  USD: 1384.5,
  JPY: 9.31,
  VND: 0.0543,
  EUR: 1502.1,
  THB: 38.24,
  TWD: 43.02,
  PHP: 24.11,
  CNY: 191.4,
  HKD: 177.8,
  SGD: 1041.2,
  AUD: 912.6,
  GBP: 1768.4,
};

/**
 * 여행지 → 기본 통화.
 * 모임을 만들 때 여행지 문자열에서 통화를 자동 추론한다. 항목마다 바꿀 수 있다.
 */
const DEST_CUR: Array<[RegExp, string]> = [
  [/제주|서울|부산|강릉|경주|여수|속초|한국|국내/, "KRW"],
  [/다낭|하노이|호치민|나트랑|베트남|푸꾸옥|하롱/, "VND"],
  [/도쿄|오사카|후쿠오카|삿포로|교토|일본|오키나와|나고야/, "JPY"],
  [/방콕|치앙마이|푸켓|태국|파타야|끄라비/, "THB"],
  [/타이베이|대만|가오슝|타이중/, "TWD"],
  [/세부|보라카이|마닐라|필리핀|보홀/, "PHP"],
  [/상하이|베이징|중국|칭다오|시안/, "CNY"],
  [/홍콩|마카오/, "HKD"],
  [/싱가포르/, "SGD"],
  [/시드니|멜버른|호주|브리즈번/, "AUD"],
  [/런던|영국|에든버러/, "GBP"],
  [/파리|로마|바르셀로나|프랑스|이탈리아|스페인|독일|유럽|프라하|비엔나|암스테르담/, "EUR"],
  [/뉴욕|하와이|괌|사이판|LA|로스앤젤레스|미국|샌프란시스코/, "USD"],
];

/** 여행지에서 기본 통화를 추론한다. 못 찾으면 KRW. */
export function guessCurrency(dest: string | null | undefined): string {
  const found = DEST_CUR.find(([re]) => re.test(dest ?? ""));
  return found ? found[1] : "KRW";
}

/** 원화 표기. `₩ 1,666,000` — 기호 뒤 한 칸, 소수점 없음. */
export const formatWon = (n: number): string =>
  "₩ " + Math.round(n).toLocaleString("ko-KR");

/** 외화 표기. `$ 120.00` — 통화별 소수 자릿수를 지킨다. */
export function formatMoney(n: number, code: string): string {
  const c = currencyOf(code);
  return (
    c.sym +
    " " +
    Number(n).toLocaleString("ko-KR", {
      minimumFractionDigits: c.dec,
      maximumFractionDigits: c.dec,
    })
  );
}

/** 외화 → 원화 정수. 정산에 들어가는 모든 금액이 이 함수를 통과한다. */
export const toWon = (cost: number, rate: number): number => Math.round(cost * rate);
