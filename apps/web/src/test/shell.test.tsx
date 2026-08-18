/**
 * ══════════ 셸 렌더 테스트 ══════════
 *
 * "흰 화면이 뜨지 않는다"를 증명하는 첫 파일이다.
 * 사이드바 항목은 넷(일정·사진·정산·문서) + 설정뿐이고, 모임 스위처는 하단 계정 칩 위에 있다.
 * 라우팅(랜딩 → 마지막 모임 / 로그인 / 온보딩)도 여기서 함께 본다.
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as F from "./fixtures.ts";
import { actionLabels, renderApp, visibleText } from "./harness.tsx";

/** 사이드바 링크의 라벨(뒤에 붙는 숫자 배지를 뗀 것). */
function navLabels(container: HTMLElement): string[] {
  const side = container.querySelector("aside.sidebar");
  return Array.from(side?.querySelectorAll("a.navitem") ?? []).map((a) =>
    (a.textContent ?? "").replace(/\d+$/, "").trim(),
  );
}

describe("셸", () => {
  it("사이드바는 일정·사진·정산·문서 + 설정 다섯 개뿐이다", async () => {
    const { container, api } = renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    expect(navLabels(container)).toEqual(["일정", "사진", "정산", "문서", "설정"]);
    expect(api.unhandled).toEqual([]);
  });

  it("사이드바 숫자 배지가 실제 값으로 채워진다 (아직 안 온 값은 0으로 속이지 않는다)", async () => {
    const { container } = renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    const side = container.querySelector("aside.sidebar")!;
    const rows = Array.from(side.querySelectorAll("a.navitem"));
    const counts = rows.map((r) => r.querySelector(".ct")?.textContent ?? "");

    // 일정 14개 · 사진 0장(빈 문자열) · 정산 남은 단계 5 · 문서 1
    await waitFor(() => {
      expect(rows[0]?.querySelector(".ct")?.textContent).toBe(String(F.items.length));
    });
    expect(counts.length).toBe(5);
    expect(side.querySelector('a[href$="/photos"] .ct')?.textContent).toBe("");
    expect(side.querySelector('a[href$="/settle"] .ct')?.textContent).toBe(
      String(F.settlement.totalSteps - F.settlement.doneCount),
    );
    expect(side.querySelector('a[href$="/docs"] .ct')?.textContent).toBe("1");
  });

  it("현재 위치를 나타내는 nav 항목이 정확히 하나다", async () => {
    const { container } = renderApp(`/g/${F.GID}/settle`);
    await screen.findByText("멤버별 장부");

    const side = container.querySelector("aside.sidebar")!;
    const current = Array.from(side.querySelectorAll("a.navitem")).filter(
      (a) => a.getAttribute("aria-current") === "page" || a.getAttribute("aria-current") === "true",
    );
    expect(current.map((a) => (a.textContent ?? "").replace(/\d+$/, "").trim())).toEqual(["정산"]);
  });

  it("헤더에 모임 제목·기간·활동 멤버 아바타가 보이고 나간 멤버는 스택에서 빠진다", async () => {
    const { container } = renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    expect(visibleText()).toContain("2026.09.12");
    // 아바타 스택은 나가지 않은 4명만
    expect(container.querySelectorAll("header.apphead .stack .who").length).toBe(4);
  });

  it("모임 스위처가 사이드바 하단 계정 칩 바로 위에 있다", async () => {
    const { container } = renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    const side = container.querySelector("aside.sidebar")!;
    const kids = Array.from(side.children);
    const card = side.querySelector(".tripcard")!;
    const acct = side.querySelector("button.acct")!;
    expect(kids.indexOf(card) + 1).toBe(kids.indexOf(acct));
    expect(card.textContent).toContain(F.GROUP_NAME);
    expect(acct.textContent).toContain("지현");
  });

  it("모임 바꾸기는 새 페이지가 아니라 모달이다", async () => {
    renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    fireEvent.click(screen.getByRole("button", { name: /모임 바꾸기/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("여행 모임")).toBeTruthy();
    expect(within(dialog).getByText("현재")).toBeTruthy();
    expect(within(dialog).getByText("새 여행 모임")).toBeTruthy();
  });

  it("멤버 초대도 모달이고 30분 만료를 먼저 읽힌다", async () => {
    renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    fireEvent.click(screen.getByRole("button", { name: /멤버 초대/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/남음/);
    expect(dialog.textContent).toContain("30분");
    // 나간 멤버는 초대 화면의 멤버 목록에서 빠진다
    expect(within(dialog).getByText(/현재 멤버 4명/)).toBeTruthy();
    expect(dialog.textContent).toContain("기영");
    expect(dialog.textContent).toContain("정산에는 “기타”로 남아 있습니다");
  });

  it("로그아웃 확인은 브라우저 confirm 이 아니라 모달이다", async () => {
    renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    fireEvent.click(screen.getByRole("button", { name: /카카오 계정 연결됨/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "로그아웃" })).toBeTruthy();
    // setup.ts 가 window.confirm 을 부르면 실패시킨다 — 여기까지 왔다는 것이 곧 증거다
  });
});

describe("랜딩 라우팅", () => {
  it("로그인 + 모임이 있으면 첫 모임으로 들어간다", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: F.GROUP_NAME })).toBeTruthy();
  });

  it("로그인하지 않았으면 로그인 화면으로 보낸다", async () => {
    renderApp("/", { "GET /api/auth/me": { user: null, authMode: "mock" } });
    expect(await screen.findByText("여행 하나를 통째로 함께")).toBeTruthy();
  });

  it("모임이 하나도 없으면 만들기 / 참여하기 두 갈래를 본다", async () => {
    renderApp("/", { "GET /api/groups": { groups: [] } });
    expect(await screen.findByText("모임 만들기")).toBeTruthy();
    expect(screen.getByText("모임 참여하기")).toBeTruthy();
    // 세 번째 갈래를 만들지 않는다
    const labels = actionLabels().filter((l) => l.includes("모임"));
    expect(labels.length).toBe(2);
  });
});
