/**
 * 일정 · 통화와 환율 · 정산 토글.
 *
 * 숙소는 이름별로 기간을 갖고, 하루에 숙소가 2개일 수 있다 (체크아웃 + 체크인).
 * 금액은 정산 토글을 켰을 때만 존재한다 — 꺼져 있으면 숨겨진 금액을 남기지 않는다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, expectSettlementInvariants, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar;
let gid: string;
let detail: any;
let it0: any;
let all: any[];

const memberId = (name: string): string => detail.members.find((m: any) => m.name === name).id;

beforeAll(async () => {
  ctx = await bootstrap();
  jh = await ctx.login("지현");
  gid = ctx.groupId;
  detail = (await jh.fetch(`/api/groups/${gid}`)).body;
  it0 = (await jh.fetch(`/api/groups/${gid}/itinerary`)).body;
  all = it0.days.flatMap((d: any) => d.items);
}, 60_000);

afterAll(async () => {
  await ctx.close();
});

describe("일정", () => {
  it("일차 5개", () => {
    expect(it0.days.length).toBe(5);
  });

  it("09.14 에 숙소가 2개다 (체크아웃 + 체크인)", () => {
    const d3 = it0.days.find((d: any) => d.date === "2026-09-14");
    expect(d3.stays.length).toBe(2);
  });

  it("하나는 체크아웃, 하나는 체크인", () => {
    const d3 = it0.days.find((d: any) => d.date === "2026-09-14");
    expect(
      d3.stays
        .map((s: any) => s.phase)
        .sort()
        .join(","),
    ).toBe("in,out");
  });

  it("항목 14건", () => {
    expect(all.length).toBe(14);
  });

  it("정산 제외 2건은 krw=0 이고 결제자가 없다", () => {
    const off = all.filter((i) => !i.split);
    expect(off.length).toBe(2);
    expect(off.every((i) => i.krw === 0 && i.payerId === null)).toBe(true);
  });

  it("결제자 미지정 3건", () => {
    expect(all.filter((i) => i.split && !i.payerId).length).toBe(3);
  });
});

describe("통화와 환율", () => {
  let rate: any;

  it("USD 마감 환율을 준다", async () => {
    rate = (await jh.fetch(`/api/groups/${gid}/rates?date=2026-09-14&cur=USD`)).body;
    expect(typeof rate.rate).toBe("number");
    expect(rate.rate).toBeGreaterThan(1000);
  });

  it("날짜가 다르면 환율도 다르다", async () => {
    const r2 = (await jh.fetch(`/api/groups/${gid}/rates?date=2026-09-15&cur=USD`)).body;
    expect(r2.rate).not.toBe(rate.rate);
  });

  it("외화 항목은 저장 시점 환율을 스냅샷하고, 정산은 원화 정수로 남는다", async () => {
    const day1 = it0.days[0];
    const res = await jh.fetch(`/api/groups/${gid}/items`, {
      method: "POST",
      body: JSON.stringify({
        dayId: day1.id,
        cat: "food",
        title: "면세점",
        time: "07:00",
        split: true,
        cost: 120.55,
        cur: "USD",
        payerId: memberId("지현"),
        shared: {
          members: detail.members.filter((m: any) => !m.left).map((m: any) => m.id),
          guests: 0,
        },
      }),
    });
    expect([200, 201]).toContain(res.status);

    const created = res.body.item ?? res.body;
    expect(created.rate).toBeGreaterThan(1000); // 서버가 스냅샷한다
    expect(Number.isInteger(created.krw)).toBe(true);
    expect(created.krw).toBeGreaterThan(100000);

    const stFx = (await jh.fetch(`/api/groups/${gid}/settlement`)).body;
    expectSettlementInvariants(stFx); // 외화가 섞여도 잔액 합 0 · 전부 정수

    expect((await jh.fetch(`/api/groups/${gid}/items/${created.id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("이미 정산함 (settled)", () => {
  /**
   * "정산 제외"(split=false)와 다르다는 것을 서버 응답으로 확인한다.
   *   정산 제외 → 금액이 실제로 0 이 된다.
   *   이미 정산 → 금액·결제자·대상이 그대로 남고 정산 계산에서만 빠진다.
   */
  it("금액은 그대로 남고 정산 계산에서만 빠진다", async () => {
    const before = (await jh.fetch(`/api/groups/${gid}/settlement`)).body;

    const created = (
      await jh.fetch(`/api/groups/${gid}/items`, {
        method: "POST",
        body: JSON.stringify({
          dayId: it0.days[0].id,
          cat: "food",
          title: "현장에서 나눠 낸 저녁",
          split: true,
          cost: 40000,
          payerId: memberId("지현"),
          shared: { members: [memberId("지현"), memberId("수아")], guests: 0 },
          settled: true,
        }),
      })
    ).body;
    const ns = created.item ?? created;

    // 금액이 살아 있다 — 이게 split=false 와 갈리는 지점이다
    expect(ns.settled).toBe(true);
    expect(ns.cost).toBe(40000);
    expect(ns.krw).toBe(40000);
    expect(ns.payerId).toBe(memberId("지현"));
    expect(ns.shared.members.length).toBe(2);

    const after = (await jh.fetch(`/api/groups/${gid}/settlement`)).body;
    // 정산 대상 지출은 그대로다 (계산에 안 들어갔다)
    expect(after.total).toBe(before.total);
    expect(after.settledTotal).toBe(before.settledTotal + 40000);
    expect(after.settledItems.map((i: any) => i.id)).toContain(ns.id);
    // 정산 제외 목록에는 없다 — 두 목록을 섞지 않는다
    expect(after.excluded.map((i: any) => i.id)).not.toContain(ns.id);
    // 실제 결제액에는 남는다
    const jhBalance = after.balance.find((b: any) => b.name === "지현");
    const jhBefore = before.balance.find((b: any) => b.name === "지현");
    expect(jhBalance.spent).toBe(jhBefore.spent + 40000);
    expect(jhBalance.paid).toBe(jhBefore.paid);
    expect(jhBalance.settled).toBe(40000);
    expectSettlementInvariants(after);

    // 되돌리면 곧바로 계산에 들어온다
    const undone = (
      await jh.fetch(`/api/groups/${gid}/items/${ns.id}`, {
        method: "PATCH",
        body: JSON.stringify({ settled: false }),
      })
    ).body;
    expect((undone.item ?? undone).settled).toBe(false);
    const back = (await jh.fetch(`/api/groups/${gid}/settlement`)).body;
    expect(back.total).toBe(before.total + 40000);
    expect(back.settledTotal).toBe(before.settledTotal);
    expectSettlementInvariants(back);

    await jh.fetch(`/api/groups/${gid}/items/${ns.id}`, { method: "DELETE" });
  });

  it("정산 토글을 끄면 settled 도 같이 꺼진다 (금액 없는 항목에 붙을 수 없다)", async () => {
    const created = (
      await jh.fetch(`/api/groups/${gid}/items`, {
        method: "POST",
        body: JSON.stringify({
          dayId: it0.days[0].id,
          cat: "food",
          title: "정산 껐다 켰다",
          split: true,
          cost: 10000,
          payerId: memberId("지현"),
          shared: { members: [memberId("지현")], guests: 0 },
          settled: true,
        }),
      })
    ).body;
    const ns = created.item ?? created;
    expect(ns.settled).toBe(true);

    const off = (
      await jh.fetch(`/api/groups/${gid}/items/${ns.id}`, {
        method: "PATCH",
        body: JSON.stringify({ split: false }),
      })
    ).body;
    const offItem = off.item ?? off;
    expect(offItem.split).toBe(false);
    expect(offItem.settled).toBe(false);
    expect(offItem.cost).toBe(0);

    await jh.fetch(`/api/groups/${gid}/items/${ns.id}`, { method: "DELETE" });
  });
});

describe("정산 토글", () => {
  it("split=false 면 금액·결제자·대상이 실제로 비워진다", async () => {
    const res = await jh.fetch(`/api/groups/${gid}/items`, {
      method: "POST",
      body: JSON.stringify({
        dayId: it0.days[0].id,
        cat: "spot",
        title: "산책",
        split: false,
        // 아래 값들은 저장되면 안 된다 — 숨겨진 금액을 남기지 않는다
        cost: 99999,
        cur: "USD",
        payerId: memberId("지현"),
        shared: { members: [memberId("지현")], guests: 3 },
      }),
    });
    const ns = res.body.item ?? res.body;

    expect(ns.cost).toBe(0);
    expect(ns.payerId).toBe(null);
    expect(ns.shared.members.length).toBe(0);
    expect(ns.shared.guests).toBe(0);
    expect(ns.krw).toBe(0);

    await jh.fetch(`/api/groups/${gid}/items/${ns.id}`, { method: "DELETE" });
  });
});
