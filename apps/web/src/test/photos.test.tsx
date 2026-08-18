/**
 * ══════════ 사진 화면 렌더 테스트 ══════════
 *
 * 사진 화면은 앨범 목록이 아니라 **폴더 탐색기**다 — 트리 + 브레드크럼 + 폴더 카드 + 그리드.
 *
 * 확인하는 확정 규칙:
 *  · 최상위 폴더 이름 = 여행 모임 제목 (지울 수 없다)
 *  · 공유는 폴더가 아니라 **묶음**에 붙는다 — 폴더별 공개 토글이 없다
 *  · 밖으로 나가는 주소는 TripMate 뷰어 링크뿐이다 — Drive 링크·서명 URL 이 화면에 없다
 *  · 공유 모달이 말하는 폴더 수·사진 수가 실제로 나가는 것과 같다
 *  · 새 폴더는 목록 위 인라인 입력이다 (폼 페이지도 모달도 아니다)
 *  · 중지·주소 재발급 확인은 브라우저 confirm 이 아니라 모달이다
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

  it("최상위 폴더는 삭제할 수 없지만 공유는 담을 수 있다", async () => {
    const { container } = await openPhotos();
    await waitFor(() => expect(container.querySelectorAll(".folders .fcard").length).toBe(4));

    // 루트는 어느 묶음에도 담기지 않았다 → 공유 중이 아니다
    expect(screen.getByText("비공개 · 모임 멤버만")).toBeTruthy();
    expect(visibleText()).toContain("최상위 폴더는 이름이 여행 모임 제목이고 지울 수 없습니다");

    const labels = actionLabels();
    // 폴더별 공개 토글은 사라졌다 — 공유는 묶음 단위다
    expect(labels.some((l) => l.includes("공개로 전환"))).toBe(false);
    expect(labels.some((l) => l.includes("비공개로 전환"))).toBe(false);
    // 루트도 묶음에 담을 수 있으니 공유 버튼은 있어야 한다
    expect(labels.some((l) => l.trim() === "공유" || l.trim() === "공유 관리")).toBe(true);
    expect(labels.some((l) => l.includes("폴더 삭제"))).toBe(false);
  });

  it("묶음에 담긴 폴더는 \"공유 중\"으로 표시된다", async () => {
    // 시드와 같다: "부모님께" 가 Day 1 을 하위까지 담았다
    await openPhotos("/f-day1");
    expect(await screen.findByText(/공유 중 · 묶음 1개/)).toBeTruthy();

    // 어느 묶음에도 없는 폴더는 비공개다 — 대조군이다
    await openPhotos("/f-receipt");
    expect(await screen.findByText("비공개 · 모임 멤버만")).toBeTruthy();
  });
  it("공유 모달은 TripMate 뷰어 링크만 내보낸다 (Drive 링크가 아니다)", async () => {
    await openPhotos("/f-day1");
    fireEvent.click(await screen.findByRole("button", { name: /^공유( 관리)?$/ }));

    const dialog = await screen.findByRole("dialog");
    // 묶음 목록은 모달을 연 뒤에 온다
    await within(dialog).findByText("부모님께");
    const link = F.shareList.shares[0]!.url;
    expect(link.startsWith("https://tripmate.app/")).toBe(true);
    expect(within(dialog).getByText(link)).toBeTruthy();

    // 밖으로 나가는 주소는 이것뿐이다
    expect(dialog.textContent).not.toContain("drive.google");
    expect(dialog.textContent).not.toContain("googleusercontent");
    // 미디어만 나간다는 사실을 화면이 말한다
    expect(dialog.textContent).toContain("사진과 동영상만");
    expect(dialog.textContent).toContain("고른 폴더 밖으로 나갈 수 없습니다");
  });

  it("공유 모달이 말하는 폴더 수가 실제로 나가는 폴더 수와 같다", async () => {
    await openPhotos("/f-day1");
    fireEvent.click(await screen.findByRole("button", { name: /^공유( 관리)?$/ }));
    const dialog = await screen.findByRole("dialog");

    // "부모님께" 는 Day 1 을 하위까지 담았다 → Day 1 + 일출봉 + 저녁 = 3개.
     // 이 숫자가 서버의 folderCount 와 다르면 그게 유출이다.
    expect(F.shareList.shares[0]!.folderCount).toBe(3);
    await waitFor(() => expect(dialog.textContent).toContain("폴더 3개"));

    // 딸려 나가는 폴더는 "자동" 으로 표시되고, 그 사실을 문장으로도 알린다
    expect(within(dialog).getAllByText("자동").length).toBe(2);
    expect(dialog.textContent).toContain("나중에 만드는 폴더도 자동으로 함께 나갑니다");
  });

  it("중지와 주소 재발급 확인은 브라우저 confirm 이 아니라 모달이다", async () => {
    await openPhotos("/f-day1");
    fireEvent.click(await screen.findByRole("button", { name: /^공유( 관리)?$/ }));
    await screen.findByRole("dialog");

    await screen.findByText("부모님께");
    // 묶음이 둘이라 "중지" 도 둘이다. 첫 번째(부모님께) 를 누른다
    fireEvent.click(screen.getAllByRole("button", { name: "중지" })[0]!);
    const stop = await screen.findByRole("heading", { name: "공유 중지" });
    const stopBox = stop.closest("[role=dialog]")!;
    expect(stopBox.textContent).toContain("즉시");
    expect(stopBox.textContent).toContain("사진은 지워지지 않습니다");
  });

  it("링크 복사는 클립보드에 TripMate 주소를 넣는다", async () => {
    await openPhotos("/f-day1");
    fireEvent.click(await screen.findByRole("button", { name: /^공유( 관리)?$/ }));
    await screen.findByRole("dialog");

    await screen.findByText("부모님께");
    fireEvent.click(screen.getAllByRole("button", { name: "링크 복사" })[0]!);
    await waitFor(() => expect(clipboardWrites.length).toBe(1));
    expect(clipboardWrites[0]).toContain("tripmate.app");
    expect(clipboardWrites[0]).not.toContain("drive.google");
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
