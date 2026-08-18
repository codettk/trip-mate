/**
 * ══════════ 로그인 · 온보딩 · 참여 렌더 테스트 ══════════
 *
 * 확인하는 확정 규칙:
 *  · **로그인은 카카오 하나뿐이다** — 이메일·비밀번호도, 구글 로그인도 없다
 *    (`AUTH_MODE=mock` 일 때만 개발용 이름 입력이 나오고, 그 사실을 화면이 스스로 말한다)
 *  · 모임이 없는 사용자는 **모임 만들기 / 모임 참여하기 두 갈래**만 본다
 *  · 초대 링크는 30분만 유효하고, 들어오면 **승인 절차 없이** 바로 멤버가 된다
 *  · 만료는 오류 화면이 아니라 안내다
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as F from "./fixtures.ts";
import { actionLabels, renderApp, visibleText } from "./harness.tsx";

const anon = { "GET /api/auth/me": { user: null, authMode: "mock" } };
const anonKakao = { "GET /api/auth/me": { user: null, authMode: "kakao" } };
const noGroups = { "GET /api/groups": { groups: [] } };

/** 로그인 화면에 절대 없어야 하는 것들. */
function expectNoOtherLogins(container: HTMLElement) {
  // 이메일·비밀번호 입력칸 자체가 없다
  expect(container.querySelectorAll("input[type=email], input[type=password]").length).toBe(0);
  // 구글 로그인은 문구로도 조작으로도 존재하지 않는다
  const text = visibleText();
  expect(text).not.toMatch(/구글/);
  expect(text).not.toMatch(/google/i);
  // "별도의 아이디·비밀번호가 없습니다" 같은 안내는 되지만, 그것을 입력받는 조작은 없다
  for (const label of actionLabels(container)) {
    expect(label).not.toMatch(/이메일|비밀번호|구글|google/i);
  }
}

describe("로그인", () => {
  it("실제 모드에서는 카카오 버튼 하나뿐이다", async () => {
    const { container } = renderApp("/login", anonKakao);

    expect(await screen.findByRole("button", { name: "카카오로 시작하기" })).toBeTruthy();
    expect(visibleText()).toContain("TripMate는 카카오 로그인만 지원합니다");
    expectNoOtherLogins(container);

    // 조작할 수 있는 것은 카카오 버튼 하나다
    expect(actionLabels(container).map((l) => l.trim())).toEqual(["카카오로 시작하기"]);
  });

  it("mock 모드는 개발 전용임을 스스로 밝히고 시드 계정만 준다", async () => {
    const { container } = renderApp("/login", anon);

    expect(await screen.findByText(/개발 전용 로그인/)).toBeTruthy();
    expect(visibleText()).toContain("실제 서비스에서는 카카오 로그인 하나만 쓰며");
    expect(container.querySelectorAll(".chips .chip").length).toBe(4);
    expectNoOtherLogins(container);
  });

  it("사진 폴더만 공유받은 사람은 로그인할 필요가 없다고 알린다", async () => {
    renderApp("/login", anonKakao);
    await screen.findByRole("button", { name: "카카오로 시작하기" });
    expect(visibleText()).toContain("받은 뷰어 링크로 바로 열립니다");
  });

  it("이미 로그인했으면 로그인 화면에 머물지 않는다", async () => {
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: F.GROUP_NAME })).toBeTruthy();
  });
});

describe("온보딩", () => {
  it("모임 만들기 / 모임 참여하기 두 갈래만 보인다", async () => {
    const { container } = renderApp("/start", noGroups);

    expect(await screen.findByText("모임 만들기")).toBeTruthy();
    expect(screen.getByText("모임 참여하기")).toBeTruthy();
    expect(container.querySelectorAll(".choice .ccard").length).toBe(2);
    expect(visibleText()).toContain("지현님, 반갑습니다");
  });

  it("초대 링크 붙여넣기는 새 페이지가 아니라 그 자리에서 펼쳐진다", async () => {
    renderApp("/start", noGroups);
    fireEvent.click(await screen.findByText("모임 참여하기"));

    expect(await screen.findByPlaceholderText(/tripmate.app\/join/)).toBeTruthy();
    expect(visibleText()).toContain("발급 후 30분");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("모임 만들기는 모달이고 제목이 Drive 폴더 이름이 된다고 말한다", async () => {
    renderApp("/start", noGroups);
    fireEvent.click(await screen.findByText("모임 만들기"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "새 여행 모임" })).toBeTruthy();
    expect(dialog.textContent).toContain("Google Drive 최상위 폴더 이름");
    // 받는 값은 제목·여행지·시작일·종료일·메모 다섯 개다 (일차는 자동 생성)
    expect(dialog.textContent).toContain("일차");
  });
});

describe("모임 참여", () => {
  it("초대 링크로 들어오면 '○○ 모임에 참여하시겠습니까?'를 먼저 묻는다", async () => {
    renderApp(`/join?code=${F.INVITE_CODE}`, noGroups);

    expect(await screen.findByText(F.GROUP_NAME)).toBeTruthy();
    expect(screen.getByText("이 모임에 참여하시겠습니까?")).toBeTruthy();
    expect(visibleText()).toContain("승인 절차는 없습니다");
    expect(screen.getByRole("button", { name: /참여하기/ })).toBeTruthy();
  });

  it("만료된 링크는 오류가 아니라 안내로 처리한다", async () => {
    renderApp(`/join?code=${F.INVITE_CODE}`, {
      ...noGroups,
      "GET /api/invites/:code": { valid: false },
    });

    expect(await screen.findByText("만료된 초대 링크입니다")).toBeTruthy();
    expect(visibleText()).toContain("발급 후 ");
    expect(visibleText()).toContain("30분");
  });

  it("코드가 없으면 흰 화면 대신 안내를 보여 준다", async () => {
    renderApp("/join", noGroups);
    expect(await screen.findByText("초대 코드가 없습니다")).toBeTruthy();
  });

  it("로그인하지 않았으면 로그인으로 보냈다가 그대로 이어 준다", async () => {
    renderApp(`/join?code=${F.INVITE_CODE}`, anonKakao);
    expect(await screen.findByRole("button", { name: "카카오로 시작하기" })).toBeTruthy();
  });
});
