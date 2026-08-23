/**
 * ══════════ 일정 화면 렌더 테스트 ══════════
 *
 * 확인하는 확정 규칙:
 *  · 전원 균등 가정 숫자("1인당 평균")를 쓰지 않고 "내 부담액"을 쓴다
 *  · 정산 제외는 조용히 사라지지 않고 금액 자리에 그렇게 적힌다
 *  · 결제자 미지정은 노란 배지로 드러나고 카드를 누르면 그 자리에서 지정한다
 *  · 나간 멤버는 "기타 · 나감"으로 표시되지만 목록에서 빠지지 않는다
 *  · 09.14 처럼 체크아웃 + 체크인이 겹치는 날은 숙소 칩이 2개다
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as F from "./fixtures.ts";
import { renderApp, visibleText } from "./harness.tsx";

const dayTab = (container: HTMLElement, n: number): HTMLElement =>
  container.querySelectorAll<HTMLElement>(".daytab")[n - 1]!;

async function openItinerary() {
  const h = renderApp(`/g/${F.GID}`);
  await screen.findAllByText("정산 대상 지출");
  return h;
}

describe("일정 화면", () => {
  it("이미 정산한 항목은 금액을 지우지 않고 '정산 완료' 배지를 붙인다", async () => {
    // "정산 제외"는 금액 자리에 글자를 쓰지만, 이쪽은 금액이 그대로 남아야 한다.
    const days = F.itinerary.days.map((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === "i10" ? { ...i, settled: true } : i)),
    }));
    const { container } = renderApp(`/g/${F.GID}`, {
      "GET /api/groups/:gid/itinerary": { days },
    });
    await screen.findAllByText("정산 대상 지출");
    fireEvent.click(dayTab(container, 2));
    await screen.findByText("애월 카페 · 야경");

    const card = screen.getByText("애월 카페 · 야경").closest(".icard")!;
    expect(card.textContent).toContain("정산 완료");
    expect(card.textContent).toContain("28,000"); // 금액이 살아 있다
    expect(card.textContent).not.toContain("정산 제외");
  });

  it("에러 없이 마운트되고 통계·탭·타임라인이 모두 보인다", async () => {
    const { container, api } = await openItinerary();

    expect(container.querySelectorAll(".daytab").length).toBe(5);
    expect(container.querySelectorAll(".tl .stop").length).toBe(6); // DAY 1 항목 6개
    expect(screen.getAllByText("₩ 1,658,570").length).toBeGreaterThan(0);
    expect(api.unhandled).toEqual([]);
  });

  it("전원 균등 가정 대신 '내 부담액'(로그인한 사람의 owed)을 보여 준다", async () => {
    await openItinerary();

    expect(screen.getByText("내 부담액")).toBeTruthy();
    expect(screen.getAllByText("₩ 415,214").length).toBeGreaterThan(0);
    const text = visibleText();
    expect(text).not.toMatch(/인당/);
    expect(text).not.toMatch(/평균/);
  });

  it("정산 제외 항목이 금액 자리에 '정산 제외'로 남는다", async () => {
    const { container } = await openItinerary();

    // DAY 2 의 해녀의집은 split=false
    fireEvent.click(dayTab(container, 2));
    expect(await screen.findByText("해녀의집")).toBeTruthy();

    const card = screen.getByText("해녀의집").closest(".icard")!;
    expect(within(card as HTMLElement).getByText("정산 제외")).toBeTruthy();
    // 통계 타일에도 몇 건이 빠졌는지 적는다
    expect(visibleText()).toContain("정산 제외 2건");
  });

  it("결제자 미지정 항목에 노란 배지가 붙는다", async () => {
    const { container } = await openItinerary();

    const card = screen.getByText("성산일출봉", { selector: "h3" }).closest(".icard") as HTMLElement;
    const badge = within(card).getByText("결제자 미지정");
    expect(badge.className).toContain("warn");
    expect(container.querySelectorAll(".icard .badge.warn").length).toBe(1); // DAY 1 에는 i4 하나뿐
  });

  it("결제자 미지정 카드를 누르면 그 자리에서 지정할 수 있는 모달이 열린다", async () => {
    await openItinerary();

    const rail = screen.getByText("결제자 미지정", { selector: "h3" }).closest("section")!;
    expect(within(rail as HTMLElement).getByText("3건")).toBeTruthy();

    fireEvent.click(within(rail as HTMLElement).getByText("비자림"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("결제자를 지금 지정하세요")).toBeTruthy();
    // 나간 멤버는 새 결제자 후보에서 빠진다
    const chips = within(dialog)
      .getByText("결제자를 지금 지정하세요")
      .parentElement!.querySelectorAll(".chip");
    // 칩은 아바타 이니셜 + 이름이다 ("지" + "지현")
    expect(Array.from(chips).map((c) => c.textContent)).toEqual([
      "지지현",
      "민민수",
      "수수아",
      "윤윤호",
    ]);
    expect(dialog.textContent).not.toContain("기영");
  });

  it("09.14 일차에는 숙소 칩이 2개다 (체크아웃 + 체크인)", async () => {
    const { container } = await openItinerary();

    fireEvent.click(dayTab(container, 3));
    const chips = container.querySelectorAll(".stayband .staycard");
    expect(chips.length).toBe(2);

    // 칩에는 이름 · 상태 · 기간이 들어간다. 여러 날에 걸친 숙소가 매일 똑같아 보이면
    // 지금이 며칠째인지 알 수 없어서 정보를 늘렸다.
    const texts = Array.from(chips).map((c) => c.textContent ?? "");
    expect(texts[0]).toContain("씨에스호텔 제주");
    expect(texts[0]).toContain("체크아웃");
    expect(texts[1]).toContain("서귀포 오션스테이");
    expect(texts[1]).toContain("체크인");

    // 체크아웃하는 날은 묵지 않으므로 박 수를 쓰지 않는다
    expect(texts[0]).not.toContain("박째");
    // 체크인한 날은 1박째다
    expect(texts[1]).toContain("1박째");
  });

  it("다른 날의 숙소 칩은 1개다", async () => {
    const { container } = await openItinerary();
    for (const n of [1, 2, 4, 5]) {
      fireEvent.click(dayTab(container, n));
      expect(container.querySelectorAll(".stayband .staycard").length).toBe(1);
    }
  });

  it("나간 멤버(기영)가 멤버 목록에 남아 '기타 · 나감'으로 표시된다", async () => {
    const { container } = await openItinerary();

    const rows = container.querySelectorAll(".mlist .mrow");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const gy = Array.from(rows).find((r) => r.textContent?.includes("기영"))!;
    expect(gy.textContent).toContain("기타 · 나감");
    expect(gy.textContent).toContain("₩ 25,714"); // 정산에서 빠지지 않는다
  });

  it("비어 있는 날은 탭에 점을 찍고 빈 날 안내를 보여 준다", async () => {
    const { container } = await openItinerary();

    // DAY 4 만 항목이 없다
    const dotted = Array.from(container.querySelectorAll<HTMLElement>(".daytab")).filter((t) =>
      t.querySelector(".dot"),
    );
    expect(dotted.length).toBe(1);

    fireEvent.click(dayTab(container, 4));
    expect(await screen.findByText("아직 비어 있는 날입니다")).toBeTruthy();
  });

  it("일정 카드를 누르면 상세 모달이 열린다 (새 페이지로 보내지 않는다)", async () => {
    await openItinerary();

    fireEvent.click(screen.getByText("씨에스호텔 제주", { selector: "h3" }).closest(".icard")!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("09.12 → 09.14 · 2박")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "수정" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "삭제" })).toBeTruthy();
  });

  it("정산 조회가 실패해도 일정 자체는 그려진다", async () => {
    renderApp(`/g/${F.GID}`, {
      "GET /api/groups/:gid/settlement": () => {
        throw new Error("boom");
      },
    });
    expect(await screen.findByText("김포 → 제주 (KE1201)")).toBeTruthy();
  });
});
