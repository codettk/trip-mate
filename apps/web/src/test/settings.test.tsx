/**
 * ══════════ 설정 화면 렌더 테스트 ══════════
 *
 * 확인하는 확정 규칙:
 *  · **반올림 단위(10원/100원) 설정이 없다** — 원 단위 고정이고 사용자 설정으로 노출하지 않는다
 *  · 저장소·환율은 서버 환경변수라 읽기 전용 상태만 보여 준다
 *  · 모임 제목을 바꾸면 Drive 최상위 폴더 이름도 같이 바뀐다고 화면이 말한다
 *  · 나간 멤버는 따로 묶여 "나감"으로 남고, 정산에는 그대로 있다고 안내한다
 *  · 미정산 잔액이 있어도 나가기를 막지 않는다 (확인은 모달로 한다)
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as F from "./fixtures.ts";
import { renderApp, visibleText } from "./harness.tsx";

const memberDetail = {
  ...F.groupDetail,
  me: { memberId: F.M.ms, role: "member" as const },
};

async function openSettings(overrides = {}) {
  const h = renderApp(`/g/${F.GID}/settings`, overrides);
  await screen.findByText("모임 정보");
  return h;
}

describe("설정 화면", () => {
  it("에러 없이 마운트되고 네 카드가 모두 그려진다", async () => {
    const { api } = await openSettings();

    expect(screen.getByText("모임 정보")).toBeTruthy();
    expect(screen.getByText("멤버")).toBeTruthy();
    expect(screen.getByText("정산과 저장소")).toBeTruthy();
    expect(screen.getByText("모임에서 나가기")).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });

  it("방장은 모임 정보를 폼으로 고치고, 제목이 Drive 폴더 이름임을 읽는다", async () => {
    await openSettings();

    expect((screen.getByDisplayValue(F.GROUP_NAME) as HTMLInputElement).type).toBe("text");
    expect(screen.getByDisplayValue("제주도")).toBeTruthy();
    expect(screen.getByDisplayValue("2026-09-12")).toBeTruthy();
    expect(screen.getByDisplayValue("2026-09-16")).toBeTruthy();
    expect(visibleText()).toContain("모임 제목이 곧 Google Drive 최상위 폴더 이름입니다");
    expect(screen.getByRole("button", { name: "저장" })).toBeTruthy();
  });

  it("반올림 단위(10원/100원) 설정이 없다 — 원 단위 고정이다", async () => {
    const { container } = await openSettings();

    const text = visibleText();
    expect(text).toContain("원 단위 반올림");
    expect(text).toContain("고정값 · 설정으로 바꿀 수 없습니다");
    expect(text).not.toContain("10원");
    expect(text).not.toContain("100원");
    expect(text).not.toContain("반올림 단위");

    // 그 줄에는 조작할 수 있는 컨트롤이 하나도 없다
    const line = screen.getByText("원 단위 반올림").closest(".li")!;
    expect(line.querySelectorAll("button, select, input").length).toBe(0);

    // 화면에 있는 select 는 **기본 통화 하나뿐**이다.
    // 반올림 단위·환율 출처·저장소를 고르는 select 가 생기면 여기서 걸린다 —
    // 반올림은 원 단위 고정이고, 환율과 저장소는 서버가 정한다.
    const selects = Array.from(container.querySelectorAll("select"));
    expect(selects.length).toBe(1);
    const cur = selects[0]!;
    expect(cur.getAttribute("id")).toBe(screen.getByText("기본 통화").getAttribute("for"));
    expect(Array.from(cur.options).map((o) => o.value)).toContain("KRW");
  });

  it("저장소와 환율은 읽기 전용이다 (시크릿이 브라우저로 내려오지 않는다)", async () => {
    await openSettings();

    expect(await screen.findByText(/local · 정상/)).toBeTruthy();
    const text = visibleText();
    expect(text).toContain("저장소와 환율 설정은 서버 환경변수라 여기서 바꾸지 않습니다");
    expect(text).not.toMatch(/리프레시 토큰|client_secret|refresh_token/i);
  });

  it("나간 멤버는 따로 묶이고 정산에는 남는다고 알린다", async () => {
    await openSettings();

    const gone = (await screen.findByText("나간 멤버")).nextElementSibling!;
    expect(gone.textContent).toContain("기영");
    expect(within(gone as HTMLElement).getByText("나감")).toBeTruthy();
    expect(visibleText()).toContain("정산에는 그대로 남습니다.");

    // 활동 멤버 4명만 위쪽 목록에 있다
    expect(screen.getByText("4명")).toBeTruthy();
  });

  it("미정산 잔액이 있어도 나가기를 막지 않고 모달로 알린다", async () => {
    await openSettings();

    fireEvent.click(screen.getByRole("button", { name: "이 모임에서 나가기" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(F.leaveCheck.message);

    const confirm = within(dialog).getByRole("button", { name: "나가기" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(dialog.textContent).toContain("정산 목록에는 “나감”으로 남고");
  });

  it("방장이 아니면 수정 폼 대신 읽기 전용이고 모임 삭제가 없다", async () => {
    await openSettings({ "GET /api/groups/:gid": memberDetail });

    expect(await screen.findByText("방장만 수정할 수 있습니다")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByRole("button", { name: "모임 삭제" })).toBeNull();
    // 다른 멤버를 내보내거나 위임할 수도 없다
    expect(screen.queryByRole("button", { name: "방장 위임" })).toBeNull();
    expect(screen.queryByRole("button", { name: "내보내기" })).toBeNull();
    // 나가기는 누구나 할 수 있다
    expect(screen.getByRole("button", { name: "이 모임에서 나가기" })).toBeTruthy();
  });

  it("방장에게는 위임·내보내기·모임 삭제가 있고, 내보내기 확인도 모달이다", async () => {
    await openSettings();

    // 나를 뺀 활동 멤버 3명
    expect((await screen.findAllByRole("button", { name: "방장 위임" })).length).toBe(3);
    fireEvent.click(screen.getAllByRole("button", { name: "내보내기" })[0]!);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("정산에는 그대로 남습니다");
    expect(dialog.textContent).toContain("계산에서 빼면 잔액 합이 0이 되지 않습니다");
    expect(screen.getByRole("button", { name: "모임 삭제" })).toBeTruthy();
  });

  it("모임 조회가 실패하면 흰 화면 대신 오류 상자를 보여 준다", async () => {
    renderApp(`/g/${F.GID}/settings`, {
      "GET /api/groups/:gid": () => {
        throw new Error("모임을 불러오지 못했습니다");
      },
    });
    expect(await screen.findByText(/모임을 불러오지 못했습니다|요청이 실패했습니다/)).toBeTruthy();
  });
});
