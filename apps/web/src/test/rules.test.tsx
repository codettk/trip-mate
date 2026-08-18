/**
 * ══════════ 확정 규칙 횡단 검사 ══════════
 *
 * 화면별 테스트가 각자 지키는 것과 별개로, **모든 화면에 한꺼번에 걸리는 규칙**을 여기서 본다.
 *
 *  1. 전원 균등을 가정한 문구·숫자("1인당", "평균", "인당")가 사용자에게 보이지 않는다
 *  2. 금액에 소수점이 없다 (`₩ 1,658,570`)
 *  3. 브라우저 대화상자(alert/confirm/prompt)를 아무 화면도 부르지 않는다
 *  4. Drive 링크·서명 URL 이 브라우저로 나가지 않는다
 *  5. ItemModal 의 정산 토글이 꺼져 있으면 금액·통화·결제자·정산 대상이 DOM 에 아예 없다
 */

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ItemModal } from "../modals/ItemModal.tsx";
import * as F from "./fixtures.ts";
import { renderApp, renderUi, visibleText } from "./harness.tsx";
import { clipboardWrites, dialogCalls } from "./setup.ts";

/** 화면 하나를 열고 로딩이 끝날 때까지 기다린다. */
const SCREENS: Array<[name: string, route: string, ready: string]> = [
  ["일정", `/g/${F.GID}`, "멤버"],
  ["정산", `/g/${F.GID}/settle`, "멤버별 장부"],
  ["사진", `/g/${F.GID}/photos`, "이 폴더에는 아직 미디어가 없습니다."],
  ["문서", `/g/${F.GID}/docs/doc1`, "제주 계획서"],
  ["설정", `/g/${F.GID}/settings`, "나간 멤버"],
  ["폴더 뷰어", `/${F.GID}/view/지현의-드론샷?t=tok-drone`, "공유된 폴더"],
  ["정산 뷰어", `/${F.GID}/settle/${F.SETTLE_TOKEN}`, "정산 진행 중"],
];

describe("확정 규칙 — 모든 화면", () => {
  it.each(SCREENS)("%s 화면에 전원 균등 가정 문구가 없다", async (_n, route, ready) => {
    renderApp(route);
    await screen.findAllByText(ready);

    const text = visibleText();
    expect(text).not.toMatch(/인당/); // "1인당"도 여기서 걸린다
    expect(text).not.toMatch(/평균/);
    expect(text).not.toMatch(/균등/);
  });

  it.each(SCREENS)("%s 화면의 금액에 소수점이 없다", async (_n, route, ready) => {
    renderApp(route);
    await screen.findAllByText(ready);

    for (const amount of visibleText().match(/₩\s*[\d.,]+/g) ?? []) {
      expect(amount).not.toContain(".");
    }
  });

  it.each(SCREENS)("%s 화면이 Drive 링크를 노출하지 않는다", async (_n, route, ready) => {
    const { container } = renderApp(route);
    await screen.findAllByText(ready);

    expect(visibleText()).not.toMatch(/drive\.google|googleusercontent|googleapis/);
    for (const el of container.querySelectorAll<HTMLElement>("[src], [href]")) {
      const url = el.getAttribute("src") ?? el.getAttribute("href") ?? "";
      expect(url).not.toMatch(/drive\.google|googleusercontent|googleapis/);
    }
  });

  it.each(SCREENS)("%s 화면이 브라우저 대화상자를 부르지 않는다", async (_n, route, ready) => {
    renderApp(route);
    await screen.findAllByText(ready);
    // setup.ts 의 스텁은 호출되면 던지고 afterEach 가 실패시킨다. 여기서 한 번 더 못을 박는다.
    expect(dialogCalls).toEqual([]);
    expect(clipboardWrites).toEqual([]);
  });
});

/* ══════════ ItemModal — 정산 토글 ══════════ */

const openItemModal = async () => {
  const h = renderUi(<ItemModal open gid={F.GID} onClose={() => undefined} />);
  await screen.findByLabelText("항목");
  return h;
};

const splitToggle = () => screen.getByRole("button", { name: /정산에 포함/ });

/** 정산 토글을 켰을 때만 존재해야 하는 입력들. */
const SPLIT_FIELDS = ["fCost", "fCur", "fPayer"];

describe("일정 폼 — 정산 토글", () => {
  it("꺼져 있으면 금액·통화·결제자·정산 대상이 DOM 에 아예 없다", async () => {
    await openItemModal();

    expect(splitToggle().getAttribute("aria-pressed")).toBe("false");
    for (const id of SPLIT_FIELDS) expect(document.getElementById(id)).toBeNull();
    expect(screen.queryByText("정산 대상 — 이 돈을 나눠 내는 사람")).toBeNull();
    expect(screen.queryByLabelText("기타 인원 늘리기")).toBeNull();
    expect(visibleText()).toContain("금액·결제자·정산 대상은 저장되지 않습니다.");
  });

  it("켜면 그 자리에서 펼쳐지고 1인 몫이 정수로 보인다", async () => {
    await openItemModal();
    fireEvent.click(splitToggle());

    for (const id of SPLIT_FIELDS) expect(document.getElementById(id)).not.toBeNull();
    expect(screen.getByText("정산 대상 — 이 돈을 나눠 내는 사람")).toBeTruthy();

    // 기본 대상은 "나가지 않은 멤버 전원" 4명 — 규칙이 아니라 기본값이다
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "100000" } });
    expect(await screen.findByText(/4명이 나눠 냅니다/)).toBeTruthy();
    expect(screen.getByText("₩ 25,000")).toBeTruthy();

    for (const a of visibleText().match(/₩\s*[\d.,]+/g) ?? []) expect(a).not.toContain(".");
  });

  it("나눠떨어지지 않으면 남는 금액을 결제자가 부담한다고 그 자리에서 알린다", async () => {
    await openItemModal();
    fireEvent.click(splitToggle());
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "100000" } });

    // 대상을 3명으로 줄인다 → 100,000 / 3 = 33,333 · 남는 1원은 결제자 부담
    const field = screen.getByText("정산 대상 — 이 돈을 나눠 내는 사람").closest(".field")!;
    const chips = field.querySelectorAll<HTMLButtonElement>(".chips .chip");
    fireEvent.click(chips[3]!);

    expect(await screen.findByText(/3명이 나눠 냅니다/)).toBeTruthy();
    expect(screen.getByText("₩ 33,333")).toBeTruthy();
    expect(field.textContent).toContain("반올림하고 남는");
    expect(screen.getByText("₩ 1")).toBeTruthy();
  });

  it("기타 인원 몫은 정산에서 빠지고 결제자가 직접 받는다고 알린다", async () => {
    await openItemModal();
    fireEvent.click(splitToggle());
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "100000" } });
    fireEvent.click(screen.getByLabelText("기타 인원 늘리기"));

    expect(await screen.findByText(/5명이 나눠 냅니다/)).toBeTruthy();
    const field = screen.getByText("정산 대상 — 이 돈을 나눠 내는 사람").closest(".field")!;
    expect(field.textContent).toContain("기타 1명 몫");
    expect(field.textContent).toContain("정산에서 빠집니다");
    expect(field.textContent).toContain("결제자가 직접 받으세요");
  });

  it("결제자는 '아직 정하지 않음'이 기본이다 (사전 배정하지 않는다)", async () => {
    await openItemModal();
    fireEvent.click(splitToggle());

    const payer = document.getElementById("fPayer") as HTMLSelectElement;
    expect(payer.value).toBe("");
    expect(payer.options[0]?.textContent).toBe("아직 정하지 않음 — 나중에 지정");
    // 나간 멤버도 이미 결제한 사람일 수 있으므로 결제자 후보에는 남는다
    expect(Array.from(payer.options).map((o) => o.textContent)).toContain("기영 (나감)");
  });

  it("토글이 꺼진 채 저장하면 숨겨진 금액을 남기지 않는다", async () => {
    const { api } = renderUi(<ItemModal open gid={F.GID} onClose={() => undefined} />, `/g/${F.GID}`, {
      "POST /api/groups/:gid/items": () => F.items[0],
    });
    await screen.findByLabelText("항목");

    fireEvent.change(screen.getByLabelText("항목"), { target: { value: "공항 픽업" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/items"))).toBe(true);
    });
    const body = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/items"))!.body as {
      split: boolean;
      cost: number;
      payerId: string | null;
      shared: { members: string[]; guests: number };
    };
    expect(body.split).toBe(false);
    expect(body.cost).toBe(0);
    expect(body.payerId).toBeNull();
    expect(body.shared).toEqual({ members: [], guests: 0 });
  });

  it("환율(rate)은 절대 클라이언트가 보내지 않는다 — 서버가 스냅샷한다", async () => {
    const { api } = renderUi(<ItemModal open gid={F.GID} onClose={() => undefined} />, `/g/${F.GID}`, {
      "POST /api/groups/:gid/items": () => F.items[0],
    });
    await screen.findByLabelText("항목");

    fireEvent.change(screen.getByLabelText("항목"), { target: { value: "저녁" } });
    fireEvent.click(screen.getByRole("button", { name: /정산에 포함/ }));
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/items"))).toBe(true);
    });
    const body = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/items"))!.body as Record<
      string,
      unknown
    >;
    expect("rate" in body).toBe(false);
    expect(body.cost).toBe(50000);
  });
});
