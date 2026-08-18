/**
 * 정산 — 이 앱의 핵심.
 *
 * 잔액 합은 정확히 0 · 이체 합 = 채권 합 · 전부 정수.
 * 전원 균등을 가정한 숫자("1인당 평균")를 응답에 두지 않고, 대신 "내 부담액"을 준다.
 * 입금 여부는 시스템이 판단하지 않는다 — 사람이 3단계로 넘긴다.
 */

import { verifySettlement } from "@tripmate/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSettlement } from "../src/services/settlement.ts";
import { bootstrap, expectSettlementInvariants, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar; // 지현 — 방장
let sa: Jar; // 수아
let gid: string;
let detail: any;
let st: any;

beforeAll(async () => {
  ctx = await bootstrap();
  jh = await ctx.login("지현");
  sa = await ctx.login("수아");
  gid = ctx.groupId;
  detail = (await jh.fetch(`/api/groups/${gid}`)).body;
  st = (await jh.fetch(`/api/groups/${gid}/settlement`)).body;
}, 60_000);

afterAll(async () => {
  await ctx.close();
});

describe("정산", () => {
  it("정산 총액 1,658,570", () => {
    expect(st.total).toBe(1658570);
  });

  it("기타 인원 몫 51,428", () => {
    expect(st.guestTotal).toBe(51428);
  });

  it("내 부담액(지현) 415,214", () => {
    expect(st.myOwed).toBe(415214);
  });

  it("잔액 합이 정확히 0 · 이체 합 = 채권 합 · 전부 정수", () => {
    expectSettlementInvariants(st);
  });

  it("이체 4건", () => {
    expect(st.transfers.length).toBe(4);
  });

  it("수아의 실제 결제액(222,000) ≠ 정산 반영액(170,570) — 반올림과 기타 인원 몫", () => {
    const s = st.balance.find((b: any) => b.name === "수아");
    expect(s.spent).toBe(222000);
    expect(s.paid).toBe(170570);
  });

  it("응답에 '1인당 평균' 같은 필드가 없다", () => {
    expect("average" in st).toBe(false);
    expect("perPerson" in st).toBe(false);
  });

  it("결제자 미지정 3건이 따로 안내된다", () => {
    expect(st.pending.length).toBe(3);
  });

  it("정산 제외 2건이 따로 안내된다", () => {
    expect(st.excluded.length).toBe(2);
  });

  it("마감되지 않았다 (미지정 남음)", () => {
    expect(st.closed).toBe(false);
  });

  it("나간 멤버(기영)도 정산에 그대로 남는다", () => {
    const gy = st.balance.find((b: any) => b.name === "기영");
    expect(gy).toBeTruthy();
    expect(gy.left).toBe(true);
  });

  it("verifySettlement 로 시드 상태의 불변식을 직접 확인한다", async () => {
    const r = await loadSettlement(gid);
    const check = verifySettlement(r);
    expect(check.problems).toEqual([]);
    expect(check.balanceSumZero).toBe(true);
    expect(check.transferMatchesCredit).toBe(true);
    expect(check.allIntegers).toBe(true);
    expect(check.ok).toBe(true);
  });
});

describe("이체 상태 — 로그인한 사람에게 해당하는 것만", () => {
  let t0: any;

  beforeAll(() => {
    t0 = st.transfers.find((t: any) => t.fromName === "수아" && t.toName === "지현");
    expect(t0).toBeTruthy();
  });

  it("수아→지현: 받는 사람(지현)은 아직 누를 수 없다", () => {
    expect(st.transfers.find((t: any) => t.fromName === "수아").canAct).toBe(null);
  });

  it("수아 본인에게는 '송금 확인 요청'이 열린다", async () => {
    const stSa = (await sa.fetch(`/api/groups/${gid}/settlement`)).body;
    expect(stSa.transfers.find((t: any) => t.fromName === "수아").canAct).toBe("req");
  });

  it("남의 송금을 대신 요청하면 403", async () => {
    const wrong = await jh.fetch(
      `/api/groups/${gid}/settlement/transfers/${t0.fromId}/${t0.toId}`,
      { method: "PUT", body: JSON.stringify({ state: "req" }) },
    );
    expect(wrong.status).toBe(403);
  });

  it("본인이 요청하면 200 이고 상태가 req 로 바뀐다", async () => {
    const req = await sa.fetch(`/api/groups/${gid}/settlement/transfers/${t0.fromId}/${t0.toId}`, {
      method: "PUT",
      body: JSON.stringify({ state: "req" }),
    });
    expect(req.status).toBe(200);
    expect(req.body.transfers.find((t: any) => t.fromName === "수아").state).toBe("req");
  });

  it("보낸 사람이 스스로 완료 처리하면 403", async () => {
    const doneWrong = await sa.fetch(
      `/api/groups/${gid}/settlement/transfers/${t0.fromId}/${t0.toId}`,
      { method: "PUT", body: JSON.stringify({ state: "done" }) },
    );
    expect(doneWrong.status).toBe(403);
  });

  it("받는 사람이 완료하면 200 이고 상태가 done", async () => {
    const done = await jh.fetch(`/api/groups/${gid}/settlement/transfers/${t0.fromId}/${t0.toId}`, {
      method: "PUT",
      body: JSON.stringify({ state: "done" }),
    });
    expect(done.status).toBe(200);
    expect(done.body.transfers.find((t: any) => t.fromName === "수아").state).toBe("done");

    // 되돌려 둔다
    await jh.fetch(`/api/groups/${gid}/settlement/transfers/${t0.fromId}/${t0.toId}`, {
      method: "PUT",
      body: JSON.stringify({ state: null }),
    });
  });
});

describe("기타 인원 몫 — 결제자가 직접 받는다", () => {
  let col: any;

  beforeAll(() => {
    col = st.collectors[0];
  });

  it("결제자 수아가 51,428원을 직접 받는다", () => {
    expect(col.name).toBe("수아");
    expect(col.amt).toBe(51428);
  });

  it("남이 대신 '받음 확인'하면 403", async () => {
    const r = await jh.fetch(`/api/groups/${gid}/settlement/guest-back/${col.id}`, {
      method: "PUT",
      body: JSON.stringify({ received: true }),
    });
    expect(r.status).toBe(403);
  });

  it("본인이 확인하면 200", async () => {
    const r = await sa.fetch(`/api/groups/${gid}/settlement/guest-back/${col.id}`, {
      method: "PUT",
      body: JSON.stringify({ received: true }),
    });
    expect(r.status).toBe(200);

    await sa.fetch(`/api/groups/${gid}/settlement/guest-back/${col.id}`, {
      method: "PUT",
      body: JSON.stringify({ received: false }),
    });
  });
});

describe("항목 수정 → 정산 재계산", () => {
  it("결제자를 지정하면 미지정이 줄고 잔액 합은 여전히 0", async () => {
    const itin = (await jh.fetch(`/api/groups/${gid}/itinerary`)).body;
    const all = itin.days.flatMap((d: any) => d.items);
    const target = all.find((i: any) => i.split && !i.payerId);
    const yh = detail.members.find((m: any) => m.name === "윤호").id;

    const patched = await jh.fetch(`/api/groups/${gid}/items/${target.id}`, {
      method: "PATCH",
      body: JSON.stringify({ payerId: yh }),
    });
    expect(patched.status).toBe(200);

    const st2 = (await jh.fetch(`/api/groups/${gid}/settlement`)).body;
    expect(st2.pending.length).toBe(2);
    expectSettlementInvariants(st2);

    // 되돌린다
    await jh.fetch(`/api/groups/${gid}/items/${target.id}`, {
      method: "PATCH",
      body: JSON.stringify({ payerId: null }),
    });
    const st3 = (await jh.fetch(`/api/groups/${gid}/settlement`)).body;
    expect(st3.pending.length).toBe(3);
    expectSettlementInvariants(st3);
  });
});
