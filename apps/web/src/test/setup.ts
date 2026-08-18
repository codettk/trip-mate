/**
 * ══════════ jsdom 보강 + 전역 안전망 ══════════
 *
 * 여기서 하는 일은 셋이다.
 *  1. jsdom 에 없는 브라우저 API 를 최소한으로 채운다 (matchMedia · clipboard · Observer …).
 *  2. **console.error 가 한 번이라도 나면 테스트를 실패시킨다.**
 *     React key 경고와 act 경고도 여기로 들어온다 — 조용히 넘기면 "흰 화면이 안 뜬다"를
 *     증명할 수 없다.
 *  3. **alert / confirm / prompt 를 부르면 실패시킨다.**
 *     CLAUDE.md 확정: 브라우저 대화상자를 쓰지 않는다.
 */

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/* ── 브라우저 대화상자 감시 ────────────────────────────────────────── */

export const dialogCalls: string[] = [];

function trapDialog(name: "alert" | "confirm" | "prompt"): void {
  Object.defineProperty(window, name, {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => {
      dialogCalls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
      throw new Error(
        `브라우저 대화상자 window.${name}() 를 호출했습니다 — ConfirmModal 을 써야 합니다`,
      );
    },
  });
}
trapDialog("alert");
trapDialog("confirm");
trapDialog("prompt");

/* ── jsdom 이 안 주는 것들 ─────────────────────────────────────────── */

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

class FakeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}
for (const key of ["IntersectionObserver", "ResizeObserver", "MutationObserver"] as const) {
  if (!(key in globalThis)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: FakeObserver });
  }
}

// 클립보드는 "링크 복사" 버튼들이 쓴다. 실제로 붙여넣을 곳이 없으니 성공으로 흉내만 낸다.
export const clipboardWrites: string[] = [];
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  writable: true,
  value: {
    writeText: (text: string) => {
      clipboardWrites.push(text);
      return Promise.resolve();
    },
    readText: () => Promise.resolve(clipboardWrites[clipboardWrites.length - 1] ?? ""),
  },
});

if (!window.scrollTo) {
  Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: () => undefined });
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
if (!URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => "blob:tripmate-test",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}
// <video preload="metadata"> 가 있는 화면에서 jsdom 이 "Not implemented" 를 뱉지 않게 한다
Object.defineProperty(HTMLMediaElement.prototype, "load", {
  configurable: true,
  writable: true,
  value: () => undefined,
});
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  writable: true,
  value: () => undefined,
});

/* ── console.error = 실패 ─────────────────────────────────────────── */

let captured: string[] = [];

beforeEach(() => {
  captured = [];
  dialogCalls.length = 0;
  clipboardWrites.length = 0;
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(" "));
  });
});

afterEach(() => {
  cleanup();
  const errors = [...captured];
  const dialogs = [...dialogCalls];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  captured = [];
  dialogCalls.length = 0;

  if (dialogs.length) {
    throw new Error(`브라우저 대화상자를 호출했습니다:\n  · ${dialogs.join("\n  · ")}`);
  }
  if (errors.length) {
    throw new Error(
      `console.error 가 ${errors.length}건 발생했습니다 (React 경고 포함):\n  · ${errors.join("\n  · ")}`,
    );
  }
});
