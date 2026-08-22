/**
 * ══════════ 셸 렌더 테스트 ══════════
 *
 * "흰 화면이 뜨지 않는다"를 증명하는 첫 파일이다.
 * 사이드바 항목은 넷(일정·사진·정산·문서) + 설정뿐이고, 모임 스위처는 하단 계정 칩 위에 있다.
 * 라우팅(랜딩 → 마지막 모임 / 로그인 / 온보딩)도 여기서 함께 본다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  // 모바일에서는 사이드바가 가로 줄로 접히면서 모임 카드(.tripcard)가 숨겨진다.
  // 헤더 제목이 같은 모달을 열지 않으면 다른 모임으로 갈 방법이 아예 없어진다.
  // 실제로 그 상태로 배포돼서 모바일 사용자가 모임을 못 바꿨다.
  it("헤더의 모임 제목을 눌러도 같은 스위처가 열린다 (모바일에는 이 입구뿐이다)", async () => {
    const { container } = renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    const head = container.querySelector("header.apphead")!;
    const title = head.querySelector("button.gswitch");
    expect(title, "헤더 제목이 스위처 버튼이어야 한다").toBeTruthy();
    expect(title!.textContent).toContain(F.GROUP_NAME);

    fireEvent.click(title!);
    const dialog = await screen.findByRole("dialog");
    // 사이드바 버튼과 **같은 모달**이다. 규칙을 두 군데 두지 않는다.
    expect(within(dialog).getByText("여행 모임")).toBeTruthy();
    expect(within(dialog).getByText("현재")).toBeTruthy();
  });

  // 계정 칩은 로그아웃 입구다. 모바일에서 display:none 이면 로그아웃이 불가능해진다.
  // 테스트 환경에는 CSS 가 안 실리므로 파일을 직접 읽어 본다.
  it("모바일 스타일이 계정 칩을 숨기지 않는다 — 로그아웃 입구다", async () => {
    const { container } = renderApp(`/g/${F.GID}`);
    await screen.findByRole("heading", { name: F.GROUP_NAME });
    expect(container.querySelector("aside.sidebar button.acct"), "계정 칩이 있어야 한다").toBeTruthy();

    // import.meta.url 은 vitest 에서 file: 스킴이 아니라 못 읽는다. cwd(apps/web) 기준으로 연다.
    const css = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width:900px)"));
    const block = mobile.slice(0, mobile.indexOf("\n}"));
    expect(block.length, "모바일 블록을 못 찾았다").toBeGreaterThan(0);

    // 선택자를 **정확히** 비교한다. `.acct>span{display:none}` 처럼 자식만 접는 규칙은
    // 입구를 막지 않으므로 통과시켜야 한다.
    const hiddenSelectors = new Set<string>();
    for (const rule of block.split("}")) {
      const i = rule.indexOf("{");
      if (i < 0 || !/display:\s*none/.test(rule.slice(i))) continue;
      for (const sel of rule.slice(0, i).split(",")) hiddenSelectors.add(sel.trim());
    }

    for (const [sel, why] of [
      [".acct", "로그아웃"],
      [".navitem", "화면 이동"],
    ] as const) {
      expect(hiddenSelectors.has(sel), `${sel} 를 모바일에서 숨기면 ${why} 가 막힌다`).toBe(false);
    }
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
