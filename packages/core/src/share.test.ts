import { describe, expect, it } from "vitest";
import { canMoveFolder, isAutoIncluded, resolveShared, sharePath, sharedFolderPath } from "./share.js";
import type { ShareFolder } from "./share.js";

/**
 *  루트
 *   ├─ 첫째날
 *   │   ├─ 오전
 *   │   └─ 오후
 *   │        └─ 노을
 *   ├─ 둘째날
 *   └─ 영수증
 */
const TREE: ShareFolder[] = [
  { id: "root", parentId: null },
  { id: "d1", parentId: "root" },
  { id: "am", parentId: "d1" },
  { id: "pm", parentId: "d1" },
  { id: "sunset", parentId: "pm" },
  { id: "d2", parentId: "root" },
  { id: "receipt", parentId: "root" },
];

const ids = (s: Set<string>): string[] => [...s].sort();

describe("묶음이 내보내는 폴더", () => {
  it("현재 폴더만 고르면 그 하나뿐이다", () => {
    expect(ids(resolveShared([{ folderId: "d1", includeDescendants: false }], TREE))).toEqual(["d1"]);
  });

  it("하위 포함은 깊이 제한 없이 전부 끌고 온다", () => {
    expect(ids(resolveShared([{ folderId: "d1", includeDescendants: true }], TREE))).toEqual([
      "am",
      "d1",
      "pm",
      "sunset",
    ]);
  });

  it("루트를 하위 포함으로 고르면 모임 전체가 나간다", () => {
    expect(resolveShared([{ folderId: "root", includeDescendants: true }], TREE).size).toBe(TREE.length);
  });

  it("루트만 고르면 루트 하나다 — 하위가 딸려 나가지 않는다", () => {
    expect(ids(resolveShared([{ folderId: "root", includeDescendants: false }], TREE))).toEqual(["root"]);
  });

  it("여러 줄을 합치고 중복을 지운다", () => {
    const out = resolveShared(
      [
        { folderId: "d1", includeDescendants: true },
        { folderId: "pm", includeDescendants: true },
        { folderId: "d2", includeDescendants: false },
      ],
      TREE,
    );
    expect(ids(out)).toEqual(["am", "d1", "d2", "pm", "sunset"]);
  });

  it("고르지 않은 폴더는 절대 들어오지 않는다", () => {
    const out = resolveShared([{ folderId: "d1", includeDescendants: true }], TREE);
    // 이게 이 함수의 전부다 — 여기서 새면 그게 유출이다
    expect(out.has("receipt")).toBe(false);
    expect(out.has("d2")).toBe(false);
    expect(out.has("root")).toBe(false);
  });

  it("지워진 폴더가 묶음에 남아 있어도 조용히 버린다", () => {
    expect(ids(resolveShared([{ folderId: "없는폴더", includeDescendants: true }], TREE))).toEqual([]);
  });

  it("빈 묶음은 아무것도 내보내지 않는다", () => {
    expect(resolveShared([], TREE).size).toBe(0);
  });
});

describe("자동 포함 배지", () => {
  const entries = [{ folderId: "d1", includeDescendants: true }];

  it("직접 담은 폴더는 자동 포함이 아니다", () => {
    expect(isAutoIncluded("d1", entries)).toBe(false);
  });

  it("딸려 온 폴더는 자동 포함이다 — 모르고 새면 안 되므로 표시한다", () => {
    expect(isAutoIncluded("am", entries)).toBe(true);
    expect(isAutoIncluded("sunset", entries)).toBe(true);
  });
});

describe("폴더 이동", () => {
  it("보통의 이동은 된다", () => {
    expect(canMoveFolder("am", "d2", TREE).ok).toBe(true);
  });

  it("자기 자신 안으로는 못 간다", () => {
    expect(canMoveFolder("d1", "d1", TREE).ok).toBe(false);
  });

  it("자기 자손 안으로는 못 간다 — 트리가 고리가 된다", () => {
    expect(canMoveFolder("d1", "am", TREE).ok).toBe(false);
    expect(canMoveFolder("d1", "sunset", TREE).ok).toBe(false); // 깊은 자손도 마찬가지
  });

  it("루트는 못 옮긴다 — 이름이 모임 제목이고 모임당 하나뿐이다", () => {
    expect(canMoveFolder("root", "d1", TREE).ok).toBe(false);
  });

  it("없는 폴더는 이유를 준다", () => {
    expect(canMoveFolder("없음", "d1", TREE).ok).toBe(false);
    expect(canMoveFolder("am", "없음", TREE).ok).toBe(false);
  });
});

describe("주소", () => {
  it("토큰이 곧 링크다 — 폴더 슬러그에서 파생시키지 않는다", () => {
    expect(sharePath("g1", "tok")).toBe("/g1/view/tok");
    expect(sharedFolderPath("g1", "tok", "첫째날")).toBe("/g1/view/tok/첫째날");
  });
});
