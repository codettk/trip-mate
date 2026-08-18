/**
 * ══════════ 공개 뷰어 렌더 테스트 ══════════
 *
 * 뷰어는 **모임 밖 사람이 보는 화면**이다. 로그인하지 않고, 셸도 사이드바도 없다.
 *
 * 확인하는 확정 규칙:
 *  · 앱(일정·사진·정산·문서)으로 넘어가는 링크가 **하나도 없다**
 *  · 폴더 뷰어는 그 폴더의 미디어만 보여 준다 — 하위·다른 폴더로 이동할 수 없고 업로드·삭제도 없다
 *  · 이미지 주소는 언제나 `/api/media/:id` 다. Drive 링크·서명 URL 이 브라우저로 나가지 않는다
 *  · 정산 뷰어(memberView:false)에는 **상태를 바꾸는 버튼이 아예 없다**
 *  · 만료·오타·비공개 전환을 한 화면으로 처리하고 어느 쪽인지 알려주지 않는다
 */

import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as F from "./fixtures.ts";
import { actionLabels, renderApp, visibleText } from "./harness.tsx";

const VIEW_PATH = `/${F.GID}/view/지현의-드론샷?t=tok-drone`;
const SETTLE_PATH = `/${F.GID}/settle/${F.SETTLE_TOKEN}`;

const photo = {
  id: "p1",
  name: "drone-001.jpg",
  mime: "image/jpeg",
  uploadedAt: "2026-09-12T10:00:00.000Z",
  takenAt: "2026-09-12T10:00:00.000Z",
  takenFallback: true,
  url: "/api/media/p1?t=tok-drone",
};

/** 뷰어에서 앱 안으로 들어가는 통로가 없음을 확인한다. */
function expectNoWayIntoApp() {
  expect(document.querySelectorAll("a").length).toBe(0);
  const text = visibleText();
  for (const w of ["일정", "정산 화면", "문서", "폴더 목록", "사진 올리기", "폴더 삭제"]) {
    expect(text).not.toContain(w);
  }
  expect(text).not.toContain("drive.google.com");
}

describe("폴더 뷰어", () => {
  it("에러 없이 마운트되고 폴더 이름 · 모임 이름 · 공유 배지가 보인다", async () => {
    const { api } = renderApp(VIEW_PATH);

    expect(await screen.findByRole("heading", { name: "지현의 드론샷" })).toBeTruthy();
    expect(screen.getByText(new RegExp(F.GROUP_NAME))).toBeTruthy();
    expect(screen.getByText("공유된 폴더")).toBeTruthy();
    expect(screen.getByText("이 폴더에는 아직 사진·동영상이 없습니다.")).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });

  it("앱으로 넘어가는 링크도, 쓰기 조작도 없다", async () => {
    const { container } = renderApp(VIEW_PATH);
    await screen.findByRole("heading", { name: "지현의 드론샷" });

    expectNoWayIntoApp();
    // 사진이 없을 때는 누를 수 있는 것 자체가 없다 (정렬 select 는 button/a 가 아니다)
    expect(actionLabels(container)).toEqual([]);
    expect(screen.queryByText("새 폴더")).toBeNull();
    expect(screen.queryByText("사진 올리기")).toBeNull();
  });

  it("이미지 주소는 TripMate 서버 주소다 — Drive 링크를 노출하지 않는다", async () => {
    renderApp(VIEW_PATH, {
      "GET /api/view/:gid/folder/:slug": { ...F.folderViewer, photos: [photo] },
    });

    const img = (await screen.findByAltText("drone-001.jpg")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/media/p1?t=tok-drone");
    expect(img.getAttribute("src")).not.toMatch(/drive|googleapis|googleusercontent/);
    // 촬영 메타데이터가 없어 업로드 시각으로 대체한 것은 배지로 알린다
    expect(screen.getByText("촬영 정보 없음")).toBeTruthy();
    expect(document.querySelectorAll("a").length).toBe(0);
  });

  it("정렬은 업로드순이 기본이고 촬영순을 고를 수 있다", async () => {
    renderApp(VIEW_PATH);
    await screen.findByRole("heading", { name: "지현의 드론샷" });

    const sel = screen.getByLabelText("정렬 기준") as HTMLSelectElement;
    expect(sel.value).toBe("up");
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["업로드순", "촬영순"]);
  });

  it("토큰이 없거나 링크가 죽었으면 이유를 가르지 않고 같은 화면을 보여 준다", async () => {
    renderApp(`/${F.GID}/view/지현의-드론샷`);
    expect(await screen.findByText("링크가 만료되었거나 잘못된 주소입니다")).toBeTruthy();
  });

  it("서버가 404 를 주어도 폴더가 있는지 없는지 알려주지 않는다", async () => {
    renderApp(VIEW_PATH, {
      "GET /api/view/:gid/folder/:slug": () => {
        throw new Error("404");
      },
    });
    expect(await screen.findByText("링크가 만료되었거나 잘못된 주소입니다")).toBeTruthy();
    expect(visibleText()).not.toContain("지현의 드론샷");
  });
});

describe("정산 뷰어", () => {
  it("에러 없이 마운트되고 이름·금액·이체 목록만 보여 준다", async () => {
    const { container, api } = renderApp(SETTLE_PATH);

    expect(await screen.findByRole("heading", { name: F.GROUP_NAME })).toBeTruthy();
    expect(screen.getByText("정산 진행 중")).toBeTruthy();
    expect(container.querySelectorAll(".ledger .lrow").length).toBe(6); // 머리줄 + 5명
    expect(container.querySelectorAll(".tline").length).toBe(5); // 이체 4 + 기타 인원 1
    expect(api.unhandled).toEqual([]);
  });

  it("상태를 바꾸는 버튼이 아예 없다", async () => {
    const { container } = renderApp(SETTLE_PATH);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    expect(container.querySelectorAll("button").length).toBe(0);
    expect(document.querySelectorAll("button").length).toBe(0);
    expect(actionLabels(container)).toEqual([]);
    const text = visibleText();
    expect(text).not.toContain("송금 확인 요청");
    expect(text).not.toContain("정산 완료를 눌러");
  });

  it("앱으로 넘어갈 수 없고 항목 제목·미지정 목록이 나가지 않는다", async () => {
    renderApp(SETTLE_PATH);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    expect(document.querySelectorAll("a").length).toBe(0);
    const text = visibleText();
    for (const w of ["해녀의집", "성산일출봉", "결제자 미지정", "정산 제외", "사진", "문서"]) {
      expect(text).not.toContain(w);
    }
  });

  it("나간 멤버도 그대로 남고 '나감'으로 표시된다", async () => {
    const { container } = renderApp(SETTLE_PATH);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    const rows = Array.from(container.querySelectorAll<HTMLElement>(".ledger .lrow"));
    const gy = rows.find((r) => r.textContent?.includes("기영"))!;
    expect(within(gy).getByText("나감")).toBeTruthy();
    expect(gy.textContent).toContain("₩ 25,714");
  });

  it("전원 균등 가정 숫자를 만들지 않고 금액이 전부 원 단위 정수다", async () => {
    renderApp(SETTLE_PATH);
    await screen.findByRole("heading", { name: F.GROUP_NAME });

    const text = visibleText();
    expect(text).not.toMatch(/인당/);
    expect(text).not.toMatch(/평균/);
    const amounts = text.match(/₩\s*[\d.,]+/g) ?? [];
    expect(amounts.length).toBeGreaterThan(8);
    for (const a of amounts) expect(a).not.toContain(".");
  });

  it("모임 멤버가 열면 읽기 전용 뷰어 대신 앱의 정산 화면으로 보낸다", async () => {
    renderApp(SETTLE_PATH, {
      "GET /api/view/:gid/settle/:token": { memberView: true, groupId: F.GID },
    });
    expect(await screen.findByText("멤버별 장부")).toBeTruthy();
  });

  it("죽은 링크는 만료 안내 하나로 처리한다", async () => {
    renderApp(SETTLE_PATH, {
      "GET /api/view/:gid/settle/:token": () => {
        throw new Error("404");
      },
    });
    expect(await screen.findByText("링크가 만료되었거나 잘못된 주소입니다")).toBeTruthy();
  });
});
