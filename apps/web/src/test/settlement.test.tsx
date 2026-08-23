/**
 * ══════════ 정산 화면 렌더 테스트 ══════════
 *
 * 확인하는 확정 규칙:
 *  · **실제 결제액**과 **정산 반영액**을 서로 다른 이름으로 둘 다 보여 준다 (수아 222,000 vs 170,570)
 *  · 나간 멤버(기영)는 회색 아바타 + "나감"으로 남고 계산에서 빠지지 않는다
 *  · 정산 제외 / 결제자 미지정 / 정산 대상 없음 / 이미 정산함을 합치지 않고 따로 안내한다
 *  · **"정산 제외"와 "이미 정산함"은 다른 것이다** — 앞은 금액이 없고, 뒤는 금액이 살아 있다
 *  · 이체 버튼은 서버가 준 `canAct` 가 있는 줄에만 켠다 — 남이 대신 눌러 줄 수 없다
 *  · 전원 균등 가정 숫자를 만들지 않는다. 금액은 전부 원 단위 정수다
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as F from "./fixtures.ts";
import { renderApp, visibleText } from "./harness.tsx";
import type { Ctx } from "./server.ts";

async function openSettlement(overrides = {}) {
  const h = renderApp(`/g/${F.GID}/settle`, overrides);
  await screen.findByText("멤버별 장부");
  return h;
}

/** 장부의 멤버 줄들 (머리줄과 합계줄을 뺀 것). */
function ledgerRows(container: HTMLElement): HTMLElement[] {
  const ledger = container.querySelector(".ledger")!;
  return Array.from(ledger.children).filter(
    (c) => !c.classList.contains("lhead") && !c.classList.contains("lfoot"),
  ) as HTMLElement[];
}

describe("정산 화면", () => {
  it("에러 없이 마운트되고 장부 + 정산서 2단이 모두 그려진다", async () => {
    const { container, api } = await openSettlement();

    expect(ledgerRows(container).length).toBe(5); // 나간 멤버 포함 5명
    expect(screen.getByText("마지막 날 정산서")).toBeTruthy();
    expect(screen.getByText(/송금 횟수를 최소로 짝지었습니다/)).toBeTruthy();
    expect(container.querySelectorAll(".tline").length).toBe(5); // 이체 4 + 기타 인원 1
    expect(api.unhandled).toEqual([]);
  });

  it("실제 결제액과 정산 반영액을 다른 이름으로 둘 다 보여 준다", async () => {
    const { container } = await openSettlement();

    const sa = ledgerRows(container).find((r) => r.textContent?.includes("수아"))!;
    expect(sa.textContent).toContain("₩ 222,000"); // 실제 결제액 (크게)
    expect(sa.textContent).toContain("실제 결제액");
    expect(sa.textContent).toContain("정산 반영액");
    expect(sa.textContent).toContain("₩ 170,570"); // 정산 반영액

    // 왜 다른지 문구로 설명한다 — 기타 인원 몫 51,428 + 반올림 2원
    expect(sa.textContent).toContain("기타 인원 몫 51,428원");
    expect(sa.textContent).toContain("반올림으로 결제자가 흡수한 2원");
  });

  it("나간 멤버(기영)가 장부에 남고 '나감'으로 표시된다", async () => {
    const { container } = await openSettlement();

    const gy = ledgerRows(container).find((r) => r.textContent?.includes("기영"))!;
    expect(within(gy).getByText("나감")).toBeTruthy();
    expect(gy.textContent).toContain("₩ 25,714"); // 낼 돈이 그대로 남아 있다
    expect(visibleText()).toContain("모임에서 나간 사람도 이미 낸 돈과 낼 돈이 있으므로");
  });

  it("잔액 합이 정확히 0이 되도록 다섯 명이 모두 표에 있다", async () => {
    const { container } = await openSettlement();

    const names = ledgerRows(container).map((r) => r.querySelector("b")?.textContent);
    expect(names).toEqual(["지현", "민수", "수아", "윤호", "기영"]);
    expect(F.settlement.balance.reduce((s, b) => s + b.net, 0)).toBe(0);
  });

  it("이체 버튼은 canAct 가 있는 줄에만 켜진다", async () => {
    const { container } = await openSettlement();

    const lines = Array.from(container.querySelectorAll<HTMLElement>(".tline"));
    const buttons = lines.flatMap((l) => Array.from(l.querySelectorAll("button")));

    // 지현으로 로그인 → 수아 → 지현 (canAct:"done") 한 줄만 누를 수 있다
    expect(buttons.map((b) => b.textContent)).toEqual(["받았습니다 · 정산 완료"]);
    expect(buttons.every((b) => !b.disabled)).toBe(true);

    // canAct 가 null 인 줄은 버튼 대신 "누가 눌러야 하는지"를 알려 준다
    const yhLine = lines.find((l) => l.textContent?.includes("₩ 38,142"))!;
    expect(yhLine.querySelectorAll("button").length).toBe(0);
    expect(yhLine.textContent).toContain("윤호님이 보낸 뒤 “송금 확인 요청”을 눌러야 합니다.");
  });

  it("기타 인원 몫은 결제자 본인만 '받음 확인'을 누른다", async () => {
    const { container } = await openSettlement();

    const line = Array.from(container.querySelectorAll<HTMLElement>(".tline")).find((l) =>
      l.textContent?.includes("모임 밖 인원 →"),
    )!;
    expect(line.textContent).toContain("₩ 51,428");
    expect(line.querySelectorAll("button").length).toBe(0); // canAct:false
    expect(line.textContent).toContain("수아님이 직접 받고 확인을 눌러야 합니다.");
  });

  it("입금 여부를 시스템이 판단하지 않는다고 화면이 말한다", async () => {
    await openSettlement();
    expect(visibleText()).toContain("입금 여부는 시스템이 판단하지 않습니다.");
    expect(screen.getByText(/0 \/ 5/)).toBeTruthy();
  });

  it("정산 제외 · 결제자 미지정을 합치지 않고 따로 안내한다", async () => {
    await openSettlement();

    const pending = screen.getByText("결제자 미지정", { selector: "h3" }).closest(".card")!;
    expect(within(pending as HTMLElement).getByText("3건")).toBeTruthy();
    expect(pending.textContent).toContain("성산일출봉");
    expect(pending.textContent).toContain("비자림");
    expect(pending.textContent).toContain("올레시장 저녁");

    const excluded = screen.getByText("정산 제외", { selector: "h3" }).closest(".card")!;
    expect(within(excluded as HTMLElement).getByText("2건")).toBeTruthy();
    expect(excluded.textContent).toContain("해녀의집");
    expect(excluded.textContent).toContain("제주 → 김포 (KE1210)");
    // 정산 제외 항목은 일정 화면으로 보내는 링크를 달지 않는다 (고칠 것이 없다)
    expect(excluded.querySelectorAll("a").length).toBe(0);

    // 대상 없음이 0건이면 그 카드는 아예 그리지 않는다
    expect(screen.queryByText("정산 대상 없음")).toBeNull();
  });

  it("'이미 정산함'을 '정산 제외'와 같은 목록에 넣지 않는다 (금액이 있는 것과 없는 것)", async () => {
    await openSettlement({
      "GET /api/groups/:gid/settlement": {
        ...F.settlement,
        settledTotal: 28000,
        settledItems: [F.brief("i10")], // 애월 카페 · 야경 · ₩28,000
        // 지현이 28,000 을 실제로 냈지만 정산 반영액에는 없다 — 그 차이를 화면이 설명해야 한다
        balance: F.settlement.balance.map((b) =>
          b.name === "지현" ? { ...b, spent: b.spent + 28000, settled: 28000 } : b,
        ),
      },
    });

    const settled = screen.getByText("이미 정산함", { selector: "h3" }).closest(".card")!;
    expect(within(settled as HTMLElement).getByText("1건")).toBeTruthy();
    expect(settled.textContent).toContain("애월 카페 · 야경");
    // 금액이 살아 있다 — "정산 제외"는 — 로 나오지만 이쪽은 숫자가 나온다
    expect(settled.textContent).toContain("28,000");

    // 정산 제외 카드는 그대로 따로 있다
    const excluded = screen.getByText("정산 제외", { selector: "h3" }).closest(".card")!;
    expect(excluded.textContent).not.toContain("애월 카페");

    // 위 합계에서 빠졌다는 사실을 숫자로 말한다
    expect(visibleText()).toContain("이미 정산한 지출 (위 합계에서 빠짐)");

    // 실제 결제액과 정산 반영액의 차이를 "반올림"으로 뭉뚱그리지 않는다
    expect(visibleText()).toContain("이미 정산한 항목 28,000원");
  });

  it("'정산에 다시 넣기'는 그 항목의 settled 만 끈다", async () => {
    const { api } = await openSettlement({
      "GET /api/groups/:gid/settlement": {
        ...F.settlement,
        settledTotal: 28000,
        settledItems: [F.brief("i10")],
      },
      "PATCH /api/groups/:gid/items/:iid": ({ params }: Ctx) => ({ id: params.iid }),
    });

    fireEvent.click(screen.getByRole("button", { name: /정산에 다시 넣기/ }));

    await waitFor(() => {
      const call = api.calls.find((c) => c.method === "PATCH" && c.path.includes("/items/"));
      expect(call).toBeTruthy();
      expect(call!.path).toBe(`/api/groups/${F.GID}/items/i10`);
      // 금액·결제자·대상을 건드리지 않는다. 보내는 것은 이 한 필드뿐이다.
      expect(call!.body).toEqual({ settled: false });
    });
  });

  it("전원 균등 가정 문구 없이 '내 부담액'만 쓴다", async () => {
    await openSettlement();

    expect(screen.getByText("내 부담액")).toBeTruthy();
    expect(screen.getAllByText("₩ 415,214").length).toBeGreaterThan(0);
    const text = visibleText();
    expect(text).not.toMatch(/인당/);
    expect(text).not.toMatch(/평균/);
  });

  it("화면의 모든 금액이 소수점 없는 원 단위 정수다", async () => {
    await openSettlement();
    const amounts = visibleText().match(/₩\s*[\d.,]+/g) ?? [];
    expect(amounts.length).toBeGreaterThan(10);
    for (const a of amounts) expect(a).not.toContain(".");
  });

  it("정산 공유는 모달이고 TripMate 주소 하나만 내보낸다", async () => {
    await openSettlement();

    fireEvent.click(screen.getByRole("button", { name: /정산 공유/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(F.settleShare.url);

    expect(dialog.textContent).toContain("읽기 전용 정산 뷰어");
    expect(dialog.textContent).toContain("사진·문서·일정으로 넘어갈 수 없습니다.");
    expect(dialog.textContent).not.toContain("drive.google.com");
  });

  it("정산 조회가 실패하면 흰 화면 대신 오류 상자를 보여 준다", async () => {
    renderApp(`/g/${F.GID}/settle`, {
      "GET /api/groups/:gid/settlement": () => {
        throw new Error("정산을 불러오지 못했습니다");
      },
    });
    expect(await screen.findByText(/정산을 불러오지 못했습니다|요청이 실패했습니다/)).toBeTruthy();
  });
});
