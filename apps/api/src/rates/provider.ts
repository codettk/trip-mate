/**
 * ══════════ 환율 ══════════
 *
 * 원화 환산은 "그 항목이 속한 일자의 최종(마감) 환율"로 한다.
 * 같은 금액이라도 날짜가 다르면 환산액이 다르다.
 *
 * 어느 API 의 마감 환율을 쓸지는 아직 안 정했다. 그래서 경계를 먼저 만들었다:
 *   fx_rates 테이블이 정본이고, RateProvider 가 그 표를 채운다.
 *   지금 구현은 SeededRateProvider (프로토타입의 RATE_BASE × 일자 흔들림).
 *   나중에 실제 API 어댑터를 하나 더 끼우면 된다 — 호출부는 안 바뀐다.
 *
 * 항목을 저장할 때 그날 환율을 items.rate 에 스냅샷한다.
 * 환율표가 나중에 갱신돼도 이미 정산된 금액이 흔들리지 않는다.
 */

import { RATE_BASE } from "@tripmate/core";
import { db, num } from "../db/client.ts";

export interface RateProvider {
  readonly source: string;
  /** 1 외화 = ? 원. KRW 는 항상 1 */
  fetch(date: string, currency: string): Promise<number>;
}

/**
 * 시드 제공자.
 * 날짜 문자열에서 결정적인 흔들림(±0.4%)을 만들어 "일자마다 환율이 다르다"를 재현한다.
 * 같은 날짜·통화는 항상 같은 값이 나오므로 테스트가 흔들리지 않는다.
 */
export class SeededRateProvider implements RateProvider {
  readonly source = "seed";

  async fetch(date: string, currency: string): Promise<number> {
    if (currency === "KRW") return 1;
    const base = RATE_BASE[currency];
    if (base === undefined) return 1;

    let h = 0;
    for (const ch of `${date}:${currency}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const drift = 1 + ((h % 800) - 400) / 100_000; // 0.996 ~ 1.004
    return Number((base * drift).toFixed(6));
  }
}

let provider: RateProvider = new SeededRateProvider();

export const setRateProvider = (p: RateProvider): void => {
  provider = p;
};

/**
 * 그 일자의 마감 환율. 표에 있으면 표를 쓰고, 없으면 제공자에게 받아 표에 채워 둔다.
 * 한 번 저장된 값은 다시 바뀌지 않는다 — 마감 환율이니까.
 */
export async function closingRate(date: string, currency: string): Promise<number> {
  if (currency === "KRW") return 1;

  const hit = await db
    .selectFrom("fx_rates")
    .select("rate")
    .where("date", "=", date)
    .where("currency", "=", currency)
    .executeTakeFirst();
  if (hit) return num(hit.rate);

  const rate = await provider.fetch(date, currency);
  await db
    .insertInto("fx_rates")
    .values({ date, currency, rate, source: provider.source })
    .onConflict((oc) => oc.columns(["date", "currency"]).doNothing())
    .execute();

  const saved = await db
    .selectFrom("fx_rates")
    .select("rate")
    .where("date", "=", date)
    .where("currency", "=", currency)
    .executeTakeFirst();
  return saved ? num(saved.rate) : rate;
}

/** 여러 통화를 한 번에. 폼에서 통화를 바꿀 때 즉시 환산액을 보여주기 위해 쓴다. */
export async function ratesOn(date: string, currencies: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of new Set(currencies)) out[c] = await closingRate(date, c);
  return out;
}
