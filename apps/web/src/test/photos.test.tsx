/**
 * ══════════ 사진 화면 렌더 테스트 ══════════
 *
 * 사진 화면은 앨범 목록이 아니라 **폴더 탐색기**다 — 트리 + 브레드크럼 + 폴더 카드 + 그리드.
 *
 * 확인하는 확정 규칙:
 *  · 최상위 폴더 이름 = 여행 모임 제목, 최상위는 공개할 수 없다
 *  · 밖으로 나가는 주소는 TripMate 뷰어 링크뿐이다 — Drive 링크·서명 URL 이 화면에 없다
 *  · 새 폴더는 목록 위 인라인 입력이다 (폼 페이지도 모달도 아니다)
 *  · 비공개로 되돌리는 확인은 브라우저 confirm 이 아니라 모달이다
 *  · 정렬은 업로드순이 기본이고 촬영순을 고를 수 있다
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as F from "./fixtures.ts";
import { actionLabels, renderApp, visibleText } from "./harness.tsx";
import { clipboardWrites } from "./setup.ts";

async function openPhotos(path = "") {
  const h = renderApp(`/g/${F.GID}/photos${path}`);
  await screen.findByText("폴더", { selector: "h3" });
  return h;
}

describe("사진 화면", () => {
  it("에러 없이 마운트되고 트리·브레드크럼·폴더 카드·그리드가 모두 있다", async () => {
    const { container, api } = await openPhotos();

    // 최상위 폴더 이름 = 모임 제목
    expect(await screen.findByRole("heading", { name: F.GROUP_NAME, level: 2 })).toBeTruthy();
    expect(container.querySelectorAll(".crumbs button").length).toBe(1);
    await waitFor(() => expect(container.querySelectorAll(".folders .fcard").length).toBe(4));
    expect(screen.getByText(/사진·동영상 0/)).toBeTruthy();
    expect(screen.getByText("이 폴더에는 아직 미디어가 없습니다.")).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });

  it("정렬은 업로드순이 기본이고 촬영순을 고를 수 있다", async () => {
    await openPhotos();

    const sel = screen.getByLabelText(/정렬/) as HTMLSelectElement;
    expect(sel.value).toBe("up");
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["업로드순", "촬영순"]);

    fireEvent.change(sel, { target: { value: "taken" } });
    await waitFor(() => expect((screen.getByLabelText(/정렬/) as HTMLSelectElement).value).toBe("taken"));
  });

  it("최상위 폴더는 공개할 수 없고 삭제 버튼도 없다", async () => {
    const { container } = await openPhotos();
    await waitFor(() => expect(container.querySelectorAll(".folders .fcard").length).toBe(4));

    expect(screen.getByText("비공개 · 모임 멤버만")).toBeTruthy();
    expect(visibleText()).toContain("최상위 폴더는 공개할 수 없습니다");
    const labels = actionLabels();
    expect(labels.some((l) => l.includes("공개로 전환"))).toBe(false);
    expect(labels.some((l) => l.includes("폴더 삭제"))).toBe(false);
  });

  it("새 폴더는 모달이 아니라 목록 위 인라인 입력이다", async () => {
    await openPhotos();

    expect(screen.queryByLabelText("새 폴더 이름")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /새 폴더/ }));

    const input = await screen.findByLabelText("새 폴더 이름");
    expect(input).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull(); // 모달을 띄우지 않는다
    expect(visibleText()).toContain("깊이 제한은 없습니다");
  });

  it("공개 폴더는 TripMate 뷰어 링크만 내보낸다 (Drive 링크가 아니다)", async () => {
    await openPhotos("/f-day1");

    await screen.findByText("공개 · 외부 뷰어 링크 열림");
    const link = F.folderView("f-day1").folder.shareUrl!;
    expect(link.startsWith("https://tripmate.app/")).toBe(true);
    expect(screen.getByText(link)).toBeTruthy();

    const text = visibleText();
    expect(text).not.toContain("drive.google.com");
    expect(text).not.toContain("googleusercontent");
    expect(text).toContain("비공개로 되돌리면 그 링크는 즉시 죽고");
  });

  it("링크 복사는 클립보드에 TripMate 주소를 넣는다", async () => {
    await openPhotos("/f-day1");
    await screen.findByText("공개 · 외부 뷰어 링크 열림");

    fireEvent.click(screen.getByRole("button", { name: "링크 복사" }));
    await waitFor(() => expect(clipboardWrites.length).toBe(1));
    expect(clipboardWrites[0]).toContain("tripmate.app");
    expect(await screen.findByRole("button", { name: "복사됨" })).toBeTruthy();
  });

  it("비공개로 되돌리는 확인은 브라우저 confirm 이 아니라 모달이다", async () => {
    await openPhotos("/f-day1");
    await screen.findByText("공개 · 외부 뷰어 링크 열림");

    fireEvent.click(screen.getByRole("button", { name: /비공개로 전환/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "비공개로 되돌릴까요?" })).toBeTruthy();
    expect(dialog.textContent).toContain("즉시 죽습니다.");
    expect(dialog.textContent).toContain("새 주소");
  });

  it("중첩 깊이에 제한이 없어 하위 폴더로 계속 들어간다", async () => {
    const { container } = await openPhotos();

    await waitFor(() => expect(container.querySelectorAll(".folders .fcard").length).toBe(4));
    fireEvent.click(screen.getByText("Day 1 · 성산", { selector: "b" }).closest("button")!);

    await screen.findByRole("heading", { name: "Day 1 · 성산", level: 2 });
    await waitFor(() =>
      expect(Array.from(container.querySelectorAll(".crumbs button")).map((b) => b.textContent)).toEqual([
        F.GROUP_NAME,
        "Day 1 · 성산",
      ]),
    );

    fireEvent.click(screen.getByText("일출봉", { selector: "b" }).closest("button")!);
    await waitFor(() =>
      expect(Array.from(container.querySelectorAll(".crumbs button")).map((b) => b.textContent)).toEqual([
        F.GROUP_NAME,
        "Day 1 · 성산",
        "일출봉",
      ]),
    );
  });

  it("업로드 대상은 지금 열어 둔 폴더라고 화면이 말한다", async () => {
    await openPhotos("/f-day2");
    await screen.findByRole("heading", { name: "Day 2 · 우도", level: 2 });

    expect(visibleText()).toContain("앱이 촬영 시각으로 자동 분류해 다른 폴더로 옮기지 않습니다");
    const drop = document.querySelector(".drop .pth")!;
    expect(drop.textContent).toContain("Day 2 · 우도");
  });

  it("폴더 조회가 실패하면 흰 화면 대신 오류 상자를 보여 준다", async () => {
    renderApp(`/g/${F.GID}/photos`, {
      "GET /api/groups/:gid/folders": () => {
        throw new Error("폴더를 불러오지 못했습니다");
      },
    });
    expect(await screen.findByText(/폴더를 불러오지 못했습니다|요청이 실패했습니다/)).toBeTruthy();
  });
});
