import { describe, expect, it } from "vitest";
import { previewSplit, settle, transferKey, verifySettlement } from "./settle.js";
import type { SettleItem, SettleMember } from "./types.js";

/** 프로토타입 시드와 같은 멤버 구성. 기영은 나간 멤버다. */
const MEMBERS: SettleMember[] = [
  { id: "jh", name: "지현", left: false },
  { id: "ms", name: "민수", left: false },
  { id: "sa", name: "수아", left: false },
  { id: "yh", name: "윤호", left: false },
  { id: "gy", name: "기영", left: true },
];
const ALL = ["jh", "ms", "sa", "yh"];

let seq = 0;
function item(p: Partial<SettleItem> & { cost?: number }): SettleItem {
  return {
    id: `i${++seq}`,
    dayN: 1,
    date: "09.12",
    title: "항목",
    cat: "food",
    split: false,
    cost: 0,
    cur: "KRW",
    rate: 1,
    payer: null,
    shared: { members: [], guests: 0 },
    ...p,
  };
}
const paid = (cost: number, payer: string | null, members: string[], guests = 0): SettleItem =>
  item({ split: true, cost, payer, shared: { members: [...members], guests } });

/** 프로토타입 index.html 의 시드 데이터. 숫자가 달라지면 알고리즘이 어긋난 것이다. */
const PROTOTYPE_ITEMS: SettleItem[] = [
  paid(316_000, "jh", ALL),
  paid(240_000, "ms", ALL),
  paid(42_000, "sa", ALL),
  paid(20_000, null, ALL), // 결제자 미지정
  paid(340_000, "jh", ALL),
  paid(180_000, "sa", [...ALL, "gy"], 2), // 나간 멤버 + 기타 2명
  paid(240_000, "yh", ALL),
  item({ title: "해녀의집" }), // 정산 제외
  paid(12_000, null, ALL), // 결제자 미지정
  paid(28_000, "jh", ["jh", "ms"]), // 둘만
  paid(24_000, "yh", ALL),
  paid(300_000, "ms", ALL),
  paid(68_000, null, ALL), // 결제자 미지정
  item({ title: "귀국편" }), // 정산 제외
];

describe("settle — 프로토타입 시드 재현", () => {
  const r = settle({ members: MEMBERS, items: PROTOTYPE_ITEMS });

  it("항목이 정산 대상 / 제외 / 미지정으로 갈린다", () => {
    expect(r.inScope).toHaveLength(12);
    expect(r.excluded).toHaveLength(2);
    expect(r.pending).toHaveLength(3);
    expect(r.noTarget).toHaveLength(0);
    expect(r.billed).toHaveLength(9);
  });

  it("실제 결제액과 정산 반영액을 따로 센다", () => {
    const by = Object.fromEntries(r.balance.map((b) => [b.id, b]));
    expect(by.jh).toMatchObject({ spent: 684_000, paid: 684_000, owed: 415_214, net: 268_786 });
    expect(by.ms).toMatchObject({ spent: 540_000, paid: 540_000, owed: 415_214, net: 124_786 });
    // 수아는 기타 인원 2명 몫이 빠져 실제 결제액과 정산 반영액이 다르다
    expect(by.sa).toMatchObject({ spent: 222_000, paid: 170_570, owed: 401_214, net: -230_644 });
    expect(by.yh).toMatchObject({ spent: 264_000, paid: 264_000, owed: 401_214, net: -137_214 });
    // 나간 멤버도 낼 돈이 그대로 남는다
    expect(by.gy).toMatchObject({ spent: 0, paid: 0, owed: 25_714, net: -25_714 });
  });

  it("수아의 실제 결제액과 정산 반영액 차이가 2원이다 (반올림 흡수)", () => {
    const sa = r.balance.find((b) => b.id === "sa")!;
    const gb = r.guestBack.sa ?? 0;
    expect(gb).toBe(51_428);
    expect(sa.spent - sa.paid - gb).toBe(2);
  });

  it("총액", () => {
    expect(r.total).toBe(1_658_570);
    expect(r.guestTotal).toBe(51_428);
  });

  it("송금 횟수를 최소화한 이체 목록을 만든다", () => {
    expect(r.transfers).toEqual([
      { fromId: "sa", fromName: "수아", toId: "jh", toName: "지현", amt: 230_644, state: null },
      { fromId: "yh", fromName: "윤호", toId: "jh", toName: "지현", amt: 38_142, state: null },
      { fromId: "yh", fromName: "윤호", toId: "ms", toName: "민수", amt: 99_072, state: null },
      { fromId: "gy", fromName: "기영", toId: "ms", toName: "민수", amt: 25_714, state: null },
    ]);
  });

  it("기타 인원 몫을 받을 사람이 따로 잡힌다", () => {
    expect(r.collectors).toEqual([{ id: "sa", name: "수아", amt: 51_428, received: false }]);
  });

  it("결제자 미지정이 남아 있으면 마감되지 않는다", () => {
    expect(r.closed).toBe(false);
    expect(r.totalSteps).toBe(5);
    expect(r.doneCount).toBe(0);
  });

  it("불변식 세 가지를 지킨다", () => {
    expect(verifySettlement(r)).toMatchObject({ ok: true, problems: [] });
  });
});

describe("settle — 마감", () => {
  const complete = PROTOTYPE_ITEMS.map((i) =>
    i.split && !i.payer ? { ...i, payer: "jh" } : i,
  );

  it("모든 이체와 수령 확인이 끝나야 마감된다", () => {
    const first = settle({ members: MEMBERS, items: complete });
    expect(first.pending).toHaveLength(0);
    expect(first.closed).toBe(false);

    const transferStates = Object.fromEntries(
      first.transfers.map((t) => [
        transferKey(t.fromId, t.toId),
        { state: "done" as const, amt: t.amt },
      ]),
    );
    const guestBackStates = Object.fromEntries(first.collectors.map((c) => [c.id, c.amt]));

    const half = settle({ members: MEMBERS, items: complete, transferStates });
    expect(half.closed).toBe(false); // 수령 확인이 남았다

    const done = settle({ members: MEMBERS, items: complete, transferStates, guestBackStates });
    expect(done.closed).toBe(true);
    expect(done.doneCount).toBe(done.totalSteps);
  });

  it("중간 상태(req)는 마감이 아니다", () => {
    const first = settle({ members: MEMBERS, items: complete });
    const t = first.transfers[0]!;
    const r = settle({
      members: MEMBERS,
      items: complete,
      transferStates: { [transferKey(t.fromId, t.toId)]: { state: "req", amt: t.amt } },
    });
    expect(r.transfers[0]!.state).toBe("req");
    expect(r.closed).toBe(false);
  });

  /**
   * 확인은 "그 금액을 주고받았다"는 뜻이다. 금액이 달라지면 다른 이체이므로
   * 예전 확인이 따라오면 안 된다 — 따라오면 마감이 풀리지 않고 차액이 사라진다.
   */
  it("이체액이 바뀌면 예전 확인이 무효가 되고 마감이 풀린다", () => {
    const two = MEMBERS.slice(0, 2);
    const items = [paid(10_000, "jh", ["jh", "ms"])];
    const before = settle({ members: two, items });
    const t = before.transfers[0]!;
    expect(t.amt).toBe(5_000);

    const states = { [transferKey(t.fromId, t.toId)]: { state: "done" as const, amt: t.amt } };
    expect(settle({ members: two, items, transferStates: states }).closed).toBe(true);

    // 같은 사람 쌍 그대로, 금액만 바뀐다 (10,000 → 30,000 → 이체 15,000)
    const raised = [{ ...items[0]!, cost: 30_000 }];
    const after = settle({ members: two, items: raised, transferStates: states });
    expect(after.transfers[0]!.amt).toBe(15_000);
    expect(after.transfers[0]!.state).toBeNull();
    expect(after.closed).toBe(false);
    expect(after.doneCount).toBe(0);
  });

  it("기타 인원 몫이 바뀌면 받음 확인도 무효가 된다", () => {
    const one = MEMBERS.slice(0, 1);
    const items = [paid(10_000, "jh", ["jh"], 1)];
    const before = settle({ members: one, items });
    const c = before.collectors[0]!;
    expect(c.amt).toBe(5_000);

    const gb = { [c.id]: c.amt };
    expect(settle({ members: one, items, guestBackStates: gb }).closed).toBe(true);

    const raised = [{ ...items[0]!, cost: 90_000 }];
    const after = settle({ members: one, items: raised, guestBackStates: gb });
    expect(after.collectors[0]!.amt).toBe(45_000);
    expect(after.collectors[0]!.received).toBe(false);
    expect(after.closed).toBe(false);
  });
});

describe("settle — 경계", () => {
  it("정산 항목이 하나도 없으면 이체도 없다", () => {
    const r = settle({ members: MEMBERS, items: [item({}), item({})] });
    expect(r.transfers).toHaveLength(0);
    expect(r.total).toBe(0);
    expect(verifySettlement(r).ok).toBe(true);
    // 미지정도 대상없음도 없으므로 마감 상태다
    expect(r.closed).toBe(true);
  });

  it("결제자가 전부 미지정이면 아무것도 계산되지 않는다", () => {
    const r = settle({ members: MEMBERS, items: [paid(50_000, null, ALL)] });
    expect(r.pending).toHaveLength(1);
    expect(r.billed).toHaveLength(0);
    expect(r.transfers).toHaveLength(0);
    expect(r.closed).toBe(false);
  });

  it("정산 대상이 0명인 항목은 통째로 빠지고 따로 안내된다", () => {
    const r = settle({ members: MEMBERS, items: [paid(50_000, "jh", [], 0)] });
    expect(r.noTarget).toHaveLength(1);
    expect(r.billed).toHaveLength(0);
    expect(r.spent.jh).toBe(50_000); // 실제 결제액에는 남는다
    expect(r.balance.every((b) => b.net === 0)).toBe(true);
    expect(r.closed).toBe(false);
  });

  it("멤버 0명 + 기타 5명 — 전액을 결제자가 직접 받는다", () => {
    const r = settle({ members: MEMBERS, items: [paid(100_000, "jh", [], 5)] });
    expect(r.total).toBe(0);
    expect(r.guestTotal).toBe(100_000);
    expect(r.collectors).toEqual([{ id: "jh", name: "지현", amt: 100_000, received: false }]);
    expect(r.transfers).toHaveLength(0);
    expect(verifySettlement(r).ok).toBe(true);
  });

  it("1원을 4명이 나누면 전원 0원이고 결제자가 1원을 흡수한다", () => {
    const r = settle({ members: MEMBERS, items: [paid(1, "jh", ALL)] });
    expect(r.total).toBe(0);
    expect(r.spent.jh).toBe(1);
    expect(r.transfers).toHaveLength(0);
    expect(verifySettlement(r).ok).toBe(true);
  });

  it("10,000원을 3명이 나누면 3,333원씩이고 1원이 남는다", () => {
    const r = settle({ members: MEMBERS, items: [paid(10_000, "jh", ["jh", "ms", "sa"])] });
    const by = Object.fromEntries(r.balance.map((b) => [b.id, b]));
    expect(by.jh!.owed).toBe(3_333);
    expect(by.jh!.paid).toBe(9_999);
    expect(by.jh!.spent).toBe(10_000);
    expect(r.transfers.map((t) => t.amt)).toEqual([3_333, 3_333]);
    expect(verifySettlement(r).ok).toBe(true);
  });

  it("혼자 결제하고 혼자 부담하면 이체가 없다", () => {
    const r = settle({ members: MEMBERS, items: [paid(30_000, "sa", ["sa"])] });
    expect(r.transfers).toHaveLength(0);
    expect(r.balance.every((b) => b.net === 0)).toBe(true);
  });

  it("나간 멤버를 빼면 잔액 합이 0이 되지 않는다 — 그래서 뺄 수 없다", () => {
    const items = [paid(100_000, "jh", ["jh", "gy"])];
    const withLeft = settle({ members: MEMBERS, items });
    expect(verifySettlement(withLeft).ok).toBe(true);

    const withoutLeft = settle({ members: MEMBERS.filter((m) => !m.left), items });
    const sum = withoutLeft.balance.reduce((s, b) => s + b.net, 0);
    expect(sum).not.toBe(0);
    expect(verifySettlement(withoutLeft).ok).toBe(false);
  });

  it("외화는 스냅샷 환율로 원화 정수 환산된다", () => {
    const usd = item({
      split: true,
      cost: 120.55,
      cur: "USD",
      rate: 1384.5,
      payer: "jh",
      shared: { members: ALL, guests: 0 },
    });
    const r = settle({ members: MEMBERS, items: [usd] });
    expect(r.items[0]!.krw).toBe(Math.round(120.55 * 1384.5));
    expect(r.fxItems).toHaveLength(1);
    expect(verifySettlement(r).ok).toBe(true);
    expect(r.balance.every((b) => Number.isInteger(b.owed))).toBe(true);
  });

  it("소수 금액이 섞여도 결과는 전부 정수다", () => {
    const items = [
      item({ split: true, cost: 1234.567, cur: "USD", rate: 1384.5, payer: "jh", shared: { members: ALL, guests: 1 } }),
      item({ split: true, cost: 99_999.99, cur: "JPY", rate: 9.3141, payer: "ms", shared: { members: ["ms", "sa"], guests: 0 } }),
    ];
    const r = settle({ members: MEMBERS, items });
    expect(verifySettlement(r)).toMatchObject({ ok: true });
  });
});

describe("settle — 무작위 1000 케이스에서 불변식이 깨지지 않는다", () => {
  /** 재현 가능한 난수 (mulberry32) — 실패하면 같은 케이스를 다시 돌릴 수 있어야 한다 */
  function rng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("잔액 합 0 · 이체 합 일치 · 전부 정수", () => {
    for (let c = 0; c < 1000; c++) {
      const rand = rng(c + 1);
      const memberCount = 2 + Math.floor(rand() * 7);
      const members: SettleMember[] = Array.from({ length: memberCount }, (_, i) => ({
        id: `m${i}`,
        name: `멤버${i}`,
        left: rand() < 0.15,
      }));
      const ids = members.map((m) => m.id);

      const itemCount = Math.floor(rand() * 25);
      const items: SettleItem[] = Array.from({ length: itemCount }, () => {
        const split = rand() < 0.85;
        if (!split) return item({});
        const targets = ids.filter(() => rand() < 0.6);
        const guests = rand() < 0.25 ? Math.floor(rand() * 5) : 0;
        const payer = rand() < 0.8 ? ids[Math.floor(rand() * ids.length)]! : null;
        const cur = rand() < 0.3 ? "USD" : "KRW";
        const rate = cur === "KRW" ? 1 : 1000 + rand() * 500;
        const cost = cur === "KRW" ? Math.floor(rand() * 2_000_000) : rand() * 3000;
        return item({ split: true, cost, cur, rate, payer, shared: { members: targets, guests } });
      });

      const r = settle({ members, items });
      const v = verifySettlement(r);
      if (!v.ok) {
        throw new Error(`케이스 ${c} 실패: ${v.problems.join(" / ")}`);
      }
    }
  });
});

describe("previewSplit — 폼 안에서 보여주는 미리보기가 서버 계산과 일치한다", () => {
  it("반올림으로 결제자가 흡수하는 금액을 그 자리에서 알려준다", () => {
    const p = previewSplit({ cost: 180_000, rate: 1, memberCount: 5, guests: 2 });
    expect(p).toEqual({
      krw: 180_000,
      parts: 7,
      per: 25_714,
      memberTotal: 128_570,
      guestCut: 51_428,
      payerAbsorbs: 2,
    });
  });

  it("대상이 0명이면 전액을 결제자가 떠안는 것으로 보여준다", () => {
    expect(previewSplit({ cost: 50_000, rate: 1, memberCount: 0, guests: 0 })).toMatchObject({
      parts: 0,
      per: 0,
      payerAbsorbs: 50_000,
    });
  });

  it("미리보기의 per 가 settle 의 per 와 같다", () => {
    const cost = 77_777;
    const p = previewSplit({ cost, rate: 1, memberCount: 3, guests: 0 });
    const r = settle({ members: MEMBERS, items: [paid(cost, "jh", ["jh", "ms", "sa"])] });
    expect(r.balance.find((b) => b.id === "ms")!.owed).toBe(p.per);
  });
});
