/**
 * ══════════ 정산 ══════════
 *
 * prototype/index.html 의 settle() 을 그대로 옮긴 것이다. 다시 쓰지 않았다.
 * 달라진 것은 전역 변수를 인자로 받게 만든 것뿐이고, 계산 순서와 반올림 위치는 한 줄도 바꾸지 않았다.
 *
 *  0. split === true 이고 settled === false 인 항목만 계산에 들어간다. krw = round(cost × rate)
 *  1. parts = shared.members.length + shared.guests,  per = round(krw / parts)
 *  2. memberTotal = per × members.length,  guestCut = per × guests
 *  3. 결제자의 "낸 돈"에는 memberTotal 만, guestCut 은 guestBack[payer] 로 따로 쌓는다
 *     (실제 결제액 spent[payer] += krw 는 표시용으로 따로 누적한다)
 *  4. 대상 멤버는 각자 per 씩 "낼 돈"에 더한다 — 나간 멤버도 포함한다
 *  5. 잔액 = 낸 돈 − 낼 돈 (합은 항상 정확히 0)
 *  6. 최대 채권자 ↔ 최대 채무자를 반복해 짝지어 이체 생성 → 송금 건수 최소화
 *
 * krw − guestCut − memberTotal 로 남는 1~2원은 결제자가 흡수한다 (3번에서 자연히 빠진다).
 * parts === 0 인 항목과 결제자 미지정 항목은 정산에서 통째로 빠지고 UI 가 각각 따로 안내한다.
 *
 * **settled(이미 정산함)는 split=false(정산 제외)와 다르다.**
 *   split=false → 금액 자체가 없다 (cost 0, payer null, 대상 없음).
 *   settled     → 금액·결제자·대상이 그대로 있고 **계산에서만** 빠진다. 현장에서 이미 주고받은 건이다.
 *   그래서 실제 결제액(spent)에는 남고 정산 반영액(paid)에는 들어가지 않는다 —
 *   그 차이는 balance.settled 로 따로 내보내 화면이 "왜 다른지"를 숫자로 설명할 수 있게 한다.
 *   이미 끝난 건이므로 결제자 미지정·대상 없음으로도 세지 않는다. 마감을 막으면 안 된다.
 *
 * ⚠ 이 파일을 고치면 잔액 합 0 · 이체 합 일치 · 전부 정수 세 가지를 반드시 검증한다.
 *    settle.test.ts 가 랜덤 케이스로 그 셋을 돌린다.
 */

import type {
  Balance,
  Collector,
  SettleInput,
  SettleItemComputed,
  SettleResult,
  Transfer,
} from "./types.js";

/** 이체 상태를 저장할 때 쓰는 키. "보낸사람>받는사람" */
export const transferKey = (from: string, to: string): string => `${from}>${to}`;

export function settle(input: SettleInput): SettleResult {
  const { members, transferStates = {}, guestBackStates = {} } = input;

  /** 나간 멤버를 포함한 전원 — 빼면 잔액 합이 0이 되지 않는다 */
  const every = members.map((m) => m.id);
  const byId = new Map(members.map((m) => [m.id, m]));

  const items: SettleItemComputed[] = input.items.map((i) => ({
    ...i,
    krw: i.split ? Math.round(i.cost * i.rate) : 0,
  }));

  const inScope = items.filter((i) => i.split);
  const excluded = items.filter((i) => !i.split);

  // 이미 주고받은 건은 여기서 한 번 걷어낸다. 아래 세 목록은 전부 "아직 남은 것"만 본다.
  const settledItems = inScope.filter((i) => i.settled);
  const live = inScope.filter((i) => !i.settled);

  const pending = live.filter((i) => !i.payer);
  const noTarget = live.filter(
    (i) => i.payer && !(i.shared.members.length + i.shared.guests),
  );
  const billed = live.filter(
    (i) => i.payer && i.shared.members.length + i.shared.guests > 0,
  );

  const zero = (): Record<string, number> =>
    Object.fromEntries(every.map((id) => [id, 0]));

  const spent = zero(); // 실제로 낸 돈
  const paid = zero(); // 정산에 반영된 낸 돈
  const owed = zero(); // 낼 돈
  const guestBack = zero(); // 모임 밖 인원에게 직접 받을 돈
  const settledPaid = zero(); // 그 중 이미 정산이 끝난 몫
  let total = 0;
  let guestTotal = 0;
  let settledTotal = 0;

  // 실제 결제액에는 이미 정산한 건도 들어간다 — 그 사람이 실제로 카드를 긁은 돈이기 때문이다.
  for (const i of inScope) {
    if (i.payer && i.payer in spent) spent[i.payer]! += i.krw;
  }
  for (const i of settledItems) {
    settledTotal += i.krw;
    if (i.payer && i.payer in settledPaid) settledPaid[i.payer]! += i.krw;
  }

  for (const i of billed) {
    const payer = i.payer!;
    const parts = i.shared.members.length + i.shared.guests;
    const per = Math.round(i.krw / parts);
    const memberTotal = per * i.shared.members.length;
    const guestCut = per * i.shared.guests;

    if (payer in paid) paid[payer]! += memberTotal;
    if (payer in guestBack) guestBack[payer]! += guestCut;
    for (const m of i.shared.members) {
      if (m in owed) owed[m]! += per;
    }
    total += memberTotal;
    guestTotal += guestCut;
  }

  const balance: Balance[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    left: m.left,
    spent: spent[m.id] ?? 0,
    paid: paid[m.id] ?? 0,
    settled: settledPaid[m.id] ?? 0,
    owed: owed[m.id] ?? 0,
    net: (paid[m.id] ?? 0) - (owed[m.id] ?? 0),
  }));

  // 채권자·채무자를 각각 큰 순서로 세운다. 동점이면 members 순서를 따른다(sort 안정성).
  const cred = balance.filter((b) => b.net > 0).map((b) => ({ ...b })).sort((a, b) => b.net - a.net);
  const debt = balance.filter((b) => b.net < 0).map((b) => ({ ...b, net: -b.net })).sort((a, b) => b.net - a.net);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < cred.length && di < debt.length) {
    const c = cred[ci]!;
    const d = debt[di]!;
    const amt = Math.min(c.net, d.net);
    if (amt > 0) {
      // 확인은 "그 금액을 주고받았다"는 뜻이다. 금액이 달라졌으면 다른 이체이므로
      // 예전 확인을 그대로 물려주지 않는다 — 그래야 마감이 자동으로 풀린다.
      const saved = transferStates[transferKey(d.id, c.id)];
      transfers.push({
        fromId: d.id,
        fromName: d.name,
        toId: c.id,
        toName: c.name,
        amt,
        state: saved && saved.amt === amt ? saved.state : null,
      });
    }
    c.net -= amt;
    d.net -= amt;
    if (c.net === 0) ci++;
    if (d.net === 0) di++;
  }

  const collectors: Collector[] = members
    .filter((m) => (guestBack[m.id] ?? 0) > 0)
    .map((m) => {
      const amt = guestBack[m.id] ?? 0;
      // 이체와 같은 규칙 — 받은 금액이 달라졌으면 "받음 확인"도 무효다.
      return { id: m.id, name: m.name, amt, received: guestBackStates[m.id] === amt };
    });

  const closed =
    pending.length === 0 &&
    noTarget.length === 0 &&
    transfers.every((t) => t.state === "done") &&
    collectors.every((c) => c.received);

  const doneCount =
    transfers.filter((t) => t.state === "done").length +
    collectors.filter((c) => c.received).length;
  const totalSteps = transfers.length + collectors.length;

  // 환율 안내는 금액이 있는 항목 전부에 해당한다 — 이미 정산한 건도 환산액으로 적혀 있다.
  const fxItems = inScope.filter((i) => i.cur !== "KRW");

  void byId; // 이름 조회는 members 순회로 충분하다. 남겨두면 오해를 만든다.

  return {
    items,
    inScope,
    excluded,
    settledItems,
    settledTotal,
    billed,
    pending,
    noTarget,
    total,
    guestTotal,
    guestBack,
    balance,
    transfers,
    collectors,
    closed,
    doneCount,
    totalSteps,
    fxItems,
    spent,
    owed,
  };
}

/** 정산 결과가 지켜야 하는 세 가지. 어긋나면 이유를 담아 돌려준다. */
export interface SettleInvariants {
  ok: boolean;
  /** 잔액 합이 정확히 0인가 */
  balanceSumZero: boolean;
  /** 이체 합이 채권 합과 같은가 */
  transferMatchesCredit: boolean;
  /** 모든 값이 정수인가 */
  allIntegers: boolean;
  problems: string[];
}

/**
 * 정산을 건드릴 때마다 이걸 통과시킨다.
 * API 는 정산 결과를 내보내기 전에 이 함수를 돌리고, 실패하면 500 을 낸다 —
 * 틀린 금액을 조용히 보여주느니 터지는 게 낫다.
 */
export function verifySettlement(r: SettleResult): SettleInvariants {
  const problems: string[] = [];

  const balanceSum = r.balance.reduce((s, b) => s + b.net, 0);
  const balanceSumZero = balanceSum === 0;
  if (!balanceSumZero) problems.push(`잔액 합이 0이 아닙니다: ${balanceSum}`);

  const creditSum = r.balance.filter((b) => b.net > 0).reduce((s, b) => s + b.net, 0);
  const transferSum = r.transfers.reduce((s, t) => s + t.amt, 0);
  const transferMatchesCredit = creditSum === transferSum;
  if (!transferMatchesCredit) {
    problems.push(`이체 합(${transferSum})이 채권 합(${creditSum})과 다릅니다`);
  }

  const nums: Array<[string, number]> = [
    ["total", r.total],
    ["guestTotal", r.guestTotal],
    ["settledTotal", r.settledTotal],
    ...r.balance.flatMap((b): Array<[string, number]> => [
      [`balance[${b.id}].spent`, b.spent],
      [`balance[${b.id}].paid`, b.paid],
      [`balance[${b.id}].settled`, b.settled],
      [`balance[${b.id}].owed`, b.owed],
      [`balance[${b.id}].net`, b.net],
    ]),
    ...r.transfers.map((t): [string, number] => [`transfer ${t.fromId}>${t.toId}`, t.amt]),
    ...r.collectors.map((c): [string, number] => [`collector ${c.id}`, c.amt]),
    ...r.items.map((i): [string, number] => [`item ${i.id}.krw`, i.krw]),
  ];
  const bad = nums.filter(([, v]) => !Number.isInteger(v));
  const allIntegers = bad.length === 0;
  for (const [k, v] of bad) problems.push(`정수가 아닙니다: ${k} = ${v}`);

  return {
    ok: balanceSumZero && transferMatchesCredit && allIntegers,
    balanceSumZero,
    transferMatchesCredit,
    allIntegers,
    problems,
  };
}

/**
 * 지출 폼 안에서 "지금 이 설정이면 1인 몫이 얼마인가"를 즉시 보여주기 위한 미리보기.
 * 서버 계산과 같은 코드(같은 반올림)를 쓰기 때문에 저장 후 숫자가 달라지지 않는다.
 */
export interface SplitPreview {
  /** 원화 정수 환산액 */
  krw: number;
  /** 분모 = 멤버 수 + 기타 인원 수 */
  parts: number;
  /** 1인 몫 */
  per: number;
  /** 멤버들이 부담하는 합 */
  memberTotal: number;
  /** 기타 인원 몫 — 정산에서 빠지고 결제자가 직접 받는다 */
  guestCut: number;
  /** 반올림 때문에 결제자가 흡수하는 금액 (0 이상일 수도, 음수일 수도 있다) */
  payerAbsorbs: number;
}

export function previewSplit(args: {
  cost: number;
  rate: number;
  memberCount: number;
  guests: number;
}): SplitPreview {
  const krw = Math.round(args.cost * args.rate);
  const parts = args.memberCount + args.guests;
  if (parts <= 0) {
    return { krw, parts: 0, per: 0, memberTotal: 0, guestCut: 0, payerAbsorbs: krw };
  }
  const per = Math.round(krw / parts);
  const memberTotal = per * args.memberCount;
  const guestCut = per * args.guests;
  return { krw, parts, per, memberTotal, guestCut, payerAbsorbs: krw - memberTotal - guestCut };
}
