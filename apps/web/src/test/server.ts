/**
 * ══════════ 가짜 API ══════════
 *
 * `global.fetch` 를 가로채 경로별로 픽스처를 돌려준다.
 * MSW 를 쓰지 않는다 — 의존성을 늘리지 않기 위해서다. 필요한 건 이만큼뿐이다.
 *
 * 등록되지 않은 경로는 501 로 답하고 `unhandled` 에 쌓는다.
 * 조용히 빈 응답을 주면 화면이 "로딩 중"에서 멈춰 무엇이 빠졌는지 알 수 없다.
 */

import { vi } from "vitest";

export interface Ctx {
  url: URL;
  method: string;
  /** 경로의 `:이름` 자리에서 뽑은 값 */
  params: Record<string, string>;
  body: unknown;
}

/** 고정 응답이거나, 요청을 보고 만드는 함수거나. (`unknown` 을 union 에 넣으면 화살표 함수의 타입 추론이 죽는다) */
export type Handler = ((c: Ctx) => unknown) | object | null;

export interface RouteMap {
  [key: string]: Handler;
}

export interface FakeApi {
  /** 실제로 나간 요청들 — 화면이 무엇을 불렀는지 확인할 때 쓴다 */
  calls: Array<{ method: string; path: string; body: unknown }>;
  /** 등록되지 않아 501 로 답한 요청들 */
  unhandled: string[];
  restore: () => void;
}

interface Compiled {
  method: string;
  re: RegExp;
  names: string[];
  handler: Handler;
}

function compile(key: string, handler: Handler): Compiled {
  const [method, path] = key.split(" ") as [string, string];
  const names: string[] = [];
  const source = path
    .split("/")
    .map((seg) => {
      if (!seg.startsWith(":")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(seg.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { method: method.toUpperCase(), re: new RegExp(`^${source}$`), names, handler };
}

/** 클라이언트가 실제로 쓰는 것만 흉내 낸다: ok · status · text() */
function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

export function installFakeApi(routes: RouteMap): FakeApi {
  const compiled = Object.entries(routes).map(([k, v]) => compile(k, v));
  const calls: FakeApi["calls"] = [];
  const unhandled: string[] = [];

  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const url = new URL(raw, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();

    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as unknown;
      } catch {
        body = init.body;
      }
    } else if (init?.body !== undefined && init.body !== null) {
      body = init.body;
    }

    calls.push({ method, path: url.pathname + url.search, body });

    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      /* 잘못 인코딩된 주소는 원문 그대로 맞춰 본다 */
    }

    for (const r of compiled) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.names.forEach((n, i) => (params[n] = m[i + 1] ?? ""));
      const value =
        typeof r.handler === "function"
          ? (r.handler as (c: Ctx) => unknown)({ url, method, params, body })
          : r.handler;
      // 204 자리 — 핸들러가 undefined 를 주면 본문 없는 성공으로 본다
      return Promise.resolve(value === undefined ? reply(204, undefined) : reply(200, value));
    }

    const what = `${method} ${url.pathname}`;
    unhandled.push(what);
    return Promise.resolve(
      reply(501, { error: { message: `가짜 API 에 등록되지 않은 경로입니다: ${what}` } }),
    );
  };

  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);

  return {
    calls,
    unhandled,
    restore: () => vi.unstubAllGlobals(),
  };
}
