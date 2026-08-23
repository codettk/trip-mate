/**
 * ══════════ 가짜 API ══════════
 *
 * `global.fetch` 와 `XMLHttpRequest` 를 가로채 경로별로 픽스처를 돌려준다.
 * 업로드만 XHR 인 이유는 fetch 에 진행 이벤트가 없기 때문이다 — 진짜 코드가 그렇게 부르므로
 * 여기서도 같은 표를 태운다. 진행률은 `manualUploads` 로 테스트가 직접 굴린다.
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

/** 붙잡아 둔 업로드 한 건. `manualUploads` 일 때만 쌓인다. */
export interface FakeUpload {
  path: string;
  /** 이 요청에 담긴 파일 이름들. 파일 하나에 요청 하나가 원칙이다 */
  files: string[];
  /** multipart 전체 바이트 (경계 포함). 진행률의 분모다 */
  total: number;
  /** 서버까지 이만큼 보냈다고 알린다 */
  progress: (loaded: number) => void;
  /** 응답을 준다. body 를 비우면 경로 표가 답한다 */
  finish: (body?: unknown, status?: number) => void;
  /** 서버가 답을 못 준 경우 (status 0) */
  fail: () => void;
}

export interface FakeApiOptions {
  /** true 면 업로드가 저절로 끝나지 않는다 — 테스트가 progress/finish 를 직접 부른다 */
  manualUploads?: boolean;
}

export interface FakeApi {
  /** 실제로 나간 요청들 — 화면이 무엇을 불렀는지 확인할 때 쓴다 */
  calls: Array<{ method: string; path: string; body: unknown }>;
  /** 등록되지 않아 501 로 답한 요청들 */
  unhandled: string[];
  /** 붙잡아 둔 업로드들 (manualUploads 일 때만) */
  uploads: FakeUpload[];
  restore: () => void;
}

interface ProgressEventLike {
  loaded: number;
  total: number;
  lengthComputable: boolean;
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

/** multipart 로 나갈 파일들. 진행률의 분모와 이름 목록을 여기서 뽑는다. */
function filesOf(body: unknown): File[] {
  if (typeof FormData === "undefined" || !(body instanceof FormData)) return [];
  return body.getAll("files").filter((v): v is File => v instanceof File);
}

/** 경계·헤더가 붙으므로 실제 전송량은 파일 크기보다 조금 크다. 그 차이를 흉내 낸다. */
const BOUNDARY_BYTES = 180;

export function installFakeApi(routes: RouteMap, opts: FakeApiOptions = {}): FakeApi {
  const compiled = Object.entries(routes).map(([k, v]) => compile(k, v));
  const calls: FakeApi["calls"] = [];
  const unhandled: string[] = [];
  const uploads: FakeUpload[] = [];

  /** 경로 표에서 답을 찾는다. fetch 와 XHR 이 같은 표를 탄다. */
  const lookup = (method: string, raw: string, body: unknown): { status: number; body: unknown } => {
    const url = new URL(raw, "http://localhost");
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
      return value === undefined ? { status: 204, body: undefined } : { status: 200, body: value };
    }

    const what = `${method} ${url.pathname}`;
    unhandled.push(what);
    return {
      status: 501,
      body: { error: { message: `가짜 API 에 등록되지 않은 경로입니다: ${what}` } },
    };
  };

  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
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

    const r = lookup(method, raw, body);
    return Promise.resolve(reply(r.status, r.body));
  };

  /** 클라이언트가 실제로 쓰는 것만 흉내 낸다: open · withCredentials · upload.onprogress · send. */
  class FakeXhr {
    status = 0;
    responseText = "";
    withCredentials = false;
    upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    #method = "GET";
    #url = "";

    open(method: string, url: string): void {
      this.#method = method.toUpperCase();
      this.#url = url;
    }
    setRequestHeader(): void {
      /* 세션은 쿠키다 — 붙일 헤더가 없다 */
    }
    send(body?: unknown): void {
      const files = filesOf(body);
      const total = files.reduce((a, f) => a + f.size, 0) + BOUNDARY_BYTES;
      const emit = (loaded: number) =>
        this.upload.onprogress?.({ loaded, total, lengthComputable: true });
      const done = (status: number, payload: unknown) => {
        this.status = status;
        this.responseText = payload === undefined ? "" : JSON.stringify(payload);
        this.onload?.();
      };

      const handle: FakeUpload = {
        path: this.#url,
        files: files.map((f) => f.name),
        total,
        progress: emit,
        finish: (payload, status) => {
          const r = payload === undefined ? lookup(this.#method, this.#url, body) : { status: status ?? 200, body: payload };
          done(r.status, r.body);
        },
        fail: () => this.onerror?.(),
      };

      if (opts.manualUploads) {
        uploads.push(handle);
        return;
      }
      // 자동 모드 — 절반, 전부, 그리고 응답. 화면이 중간 상태를 그려도 곧 끝난다.
      setTimeout(() => {
        emit(Math.floor(total / 2));
        emit(total);
        const r = lookup(this.#method, this.#url, body);
        done(r.status, r.body);
      }, 0);
    }
  }

  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  vi.stubGlobal("XMLHttpRequest", FakeXhr);

  return {
    calls,
    unhandled,
    uploads,
    restore: () => vi.unstubAllGlobals(),
  };
}
