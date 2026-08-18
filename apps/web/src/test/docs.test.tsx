/**
 * ══════════ 문서 화면 렌더 테스트 ══════════
 *
 * 확인하는 확정 규칙:
 *  · 문서는 **모임 멤버 전용**이다 — 공개 토글도, 공유 링크도, "링크 복사" 버튼도 없다
 *  · 문서는 일차에 묶이지 않는다
 *  · 새 문서는 목록 위 인라인 입력이다 (폼 페이지도 모달도 아니다)
 *  · 정산서 블록은 금액을 굳혀 두지 않고 정산 API 를 다시 불러 그린다.
 *    이체 상태를 넘기는 버튼은 정산 화면에만 있다
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as F from "./fixtures.ts";
import { actionLabels, renderApp, visibleText } from "./harness.tsx";

/** "밖으로 내보내는 조작"으로 읽힐 수 있는 라벨. 문서 화면에는 하나도 없어야 한다. */
const SHARE_WORDS = ["공유", "공개", "링크 복사", "뷰어", "복사"];

describe("문서 목록", () => {
  it("에러 없이 마운트되고 목록 + 빈 상태 안내가 보인다", async () => {
    const { api } = renderApp(`/g/${F.GID}/docs`);

    expect(await screen.findByText("제주 계획서", { selector: ".nm" })).toBeTruthy();
    expect(screen.getByText("문서를 고르세요")).toBeTruthy();
    expect(visibleText()).toContain("문서는 일차에 묶이지 않습니다");
    expect(api.unhandled).toEqual([]);
  });

  it("새 문서는 모달이 아니라 목록 위 인라인 입력이다", async () => {
    renderApp(`/g/${F.GID}/docs`);
    await screen.findByText("제주 계획서", { selector: ".nm" });

    expect(screen.queryByPlaceholderText("문서 제목")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /새 문서/ })[0]!);

    expect(await screen.findByPlaceholderText("문서 제목")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("문서 목록 화면에 공유·공개 조작이 하나도 없다", async () => {
    renderApp(`/g/${F.GID}/docs`);
    await screen.findByText("제주 계획서", { selector: ".nm" });

    const labels = actionLabels();
    for (const w of SHARE_WORDS) {
      expect(labels.filter((l) => l.includes(w))).toEqual([]);
    }
  });
});

describe("문서 본문", () => {
  it("블록 3개가 모두 그려지고 '모임 멤버 전용' 배지가 붙는다", async () => {
    const { api } = renderApp(`/g/${F.GID}/docs/doc1`);

    expect(await screen.findByRole("button", { name: "제주 계획서" })).toBeTruthy();
    expect(screen.getByText("모임 멤버 전용")).toBeTruthy();
    expect(visibleText()).toContain("외부로 공유되지 않습니다");

    expect(document.querySelectorAll("section.block").length).toBe(3);
    expect(screen.getByText("시간표 블록")).toBeTruthy();
    expect(screen.getByText("메모 블록")).toBeTruthy();
    expect(screen.getByText("숙소 블록")).toBeTruthy();

    // 시간표·숙소 블록의 내용이 실제로 들어와 있다
    expect((screen.getByDisplayValue("우도 도선 탑승") as HTMLInputElement).value).toBe("우도 도선 탑승");
    expect(screen.getByDisplayValue("씨에스호텔 제주")).toBeTruthy();
    expect(screen.getAllByText("₩ 340,000").length).toBeGreaterThan(0);
    expect(api.unhandled).toEqual([]);
  });

  it("블록 추가 버튼이 다섯 종류 다 있다", async () => {
    renderApp(`/g/${F.GID}/docs/doc1`);
    await screen.findByRole("button", { name: "제주 계획서" });

    const bar = screen.getByText("블록 추가").closest(".addblock")!;
    expect(Array.from(bar.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "시간표",
      "지도",
      "숙소",
      "정산서",
      "메모",
    ]);
  });

  it("문서 본문에도 공유·공개·링크 복사 조작이 없다", async () => {
    renderApp(`/g/${F.GID}/docs/doc1`);
    await screen.findByRole("button", { name: "제주 계획서" });

    const labels = actionLabels();
    for (const w of SHARE_WORDS) {
      expect(labels.filter((l) => l.includes(w))).toEqual([]);
    }
    // 앱 밖으로 나가는 주소도 없다
    expect(document.querySelectorAll('a[href^="http"]').length).toBe(0);
  });

  it("제목은 클릭하면 그 자리에서 입력칸이 된다", async () => {
    renderApp(`/g/${F.GID}/docs/doc1`);
    const title = await screen.findByRole("button", { name: "제주 계획서" });

    fireEvent.click(title);
    const input = await screen.findByLabelText("문서 제목");
    expect((input as HTMLInputElement).value).toBe("제주 계획서");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("삭제 확인은 브라우저 confirm 이 아니라 모달이다", async () => {
    renderApp(`/g/${F.GID}/docs/doc1`);
    await screen.findByRole("button", { name: "제주 계획서" });

    fireEvent.click(screen.getByRole("button", { name: "문서 삭제" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "문서 삭제" })).toBeTruthy();
    expect(dialog.textContent).toContain("되돌릴 수 없습니다");
  });

  it("정산서 블록은 값을 굳히지 않고 정산을 다시 불러오며, 상태를 바꾸는 버튼이 없다", async () => {
    renderApp(`/g/${F.GID}/docs/doc1`, {
      "GET /api/groups/:gid/docs/:did": {
        doc: F.docDetail.doc,
        blocks: [{ id: "b-settle", kind: "settle", position: 0, content: {} }],
      },
    });

    expect(await screen.findByText(/정산 화면과 같은 계산을 그때그때 다시 불러옵니다/)).toBeTruthy();
    const block = document.querySelector("section.block")!;
    expect(block.textContent).toContain("₩ 1,658,570"); // 정산 반영액
    expect(block.textContent).toContain("₩ 51,428"); // 기타 인원 몫
    expect(block.textContent).toContain("정산 상태를 바꾸는 것은 정산 화면에서 합니다.");

    const labels = Array.from(block.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.includes("정산 완료"))).toBe(false);
    expect(labels.some((l) => l.includes("송금 확인 요청"))).toBe(false);
    expect(labels.some((l) => l.includes("받음 확인"))).toBe(false);
  });

  it("없는 문서는 흰 화면 대신 안내를 보여 준다", async () => {
    renderApp(`/g/${F.GID}/docs/nope`, {
      "GET /api/groups/:gid/docs/:did": () => {
        throw new Error("없음");
      },
    });
    expect(await screen.findByText(/문서를 찾을 수 없습니다|요청이 실패했습니다|없음/)).toBeTruthy();
  });
});
