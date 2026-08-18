/**
 * 통합 테스트 공용 도구 — 서버 부팅 · 쿠키 잡 · 로그인.
 *
 * 세션이 httpOnly 쿠키라서 요청마다 set-cookie 를 이어 받아야 한다.
 * app.inject() 로는 쿠키를 손으로 옮겨야 하므로, 임의 포트로 실제 listen 하고 fetch 로 때린다.
 * 실사용 흐름(멀티파트 업로드·스트리밍 응답)까지 그대로 태울 수 있다.
 */

import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { buildApp } from "../src/app.ts";
import { closeDb } from "../src/db/client.ts";
import { seed, wipe } from "../src/db/seed.ts";

const silent = (): void => undefined;

export interface Res {
  status: number;
  // 응답 스키마는 검사 대상 그 자체다. 여기서 타입으로 굳히면 회귀를 놓친다.
  body: any;
  headers: Headers;
}

export interface Jar {
  readonly cookie: string;
  fetch(path: string, init?: RequestInit): Promise<Res>;
}

export interface Ctx {
  app: FastifyInstance;
  base: string;
  /** 시드 모임 "제주도 4박 5일" */
  groupId: string;
  jar(): Jar;
  login(name: string): Promise<Jar>;
  close(): Promise<void>;
}

/** 시드 모임의 고정값 — 프로토타입과 1:1 이다. */
export const GROUP_NAME = "제주도 4박 5일";

/**
 * 매 파일이 같은 출발점에서 시작한다.
 * wipe() 는 같은 이름의 시드 모임을 통째로 지우므로, 앞 파일이 남긴 멤버·항목이 새지 않는다.
 */
export async function bootstrap(): Promise<Ctx> {
  await wipe(silent);
  await seed(silent);

  const app = await buildApp();
  // 요청 로그가 검사 결과를 덮지 않게 한다 (src 는 건드리지 않는다).
  app.log.level = "silent";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  const jar = (): Jar => {
    let cookie = "";
    return {
      get cookie() {
        return cookie;
      },
      async fetch(path: string, init: RequestInit = {}): Promise<Res> {
        const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
        const res = await fetch(base + path, {
          ...init,
          headers: {
            ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
            ...(cookie ? { cookie } : {}),
            ...((init.headers as Record<string, string>) ?? {}),
          },
        });
        for (const c of res.headers.getSetCookie()) {
          const m = /^tm_session=([^;]*)/.exec(c);
          if (m) cookie = `tm_session=${m[1]}`;
        }
        const text = await res.text();
        let body: unknown = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        return { status: res.status, body, headers: res.headers };
      },
    };
  };

  const login = async (name: string): Promise<Jar> => {
    const j = jar();
    const r = await j.fetch("/api/auth/mock", { method: "POST", body: JSON.stringify({ name }) });
    if (r.status !== 200) throw new Error(`목 로그인 실패 (${name}): ${JSON.stringify(r.body)}`);
    return j;
  };

  // 시드 모임 id 는 방장 세션으로 찾는다 (seed() 의 반환값을 그대로 써도 되지만
  // 목록 API 가 실제로 그 모임을 보여주는지까지 여기서 한 번 태운다).
  const owner = await login("지현");
  const list = await owner.fetch("/api/groups");
  const g = list.body?.groups?.find((x: { name: string }) => x.name === GROUP_NAME);
  if (!g) throw new Error(`시드 모임을 찾지 못했습니다: ${JSON.stringify(list.body)}`);

  return {
    app,
    base,
    groupId: g.id,
    jar,
    login,
    async close() {
      // 미디어 스트림 응답 직후에는 keep-alive 소켓이 아직 idle 로 돌아오지 않아
      // fastify 의 close 가 keepAliveTimeout(72초)까지 기다린다. 남은 소켓을 직접 끊는다.
      const closing = app.close();
      app.server.closeAllConnections();
      await closing;
      await closeDb();
    },
  };
}

/**
 * 정산 불변식. 정산을 건드리는 검사는 전부 이걸 통과해야 한다.
 * 잔액 합이 정확히 0 · 이체 합 = 채권 합 · 전부 정수.
 */
export function expectSettlementInvariants(st: any): void {
  const sum = st.balance.reduce((s: number, b: any) => s + b.net, 0);
  expect(sum).toBe(0);

  const credit = st.balance
    .filter((b: any) => b.net > 0)
    .reduce((s: number, b: any) => s + b.net, 0);
  expect(st.transfers.reduce((s: number, t: any) => s + t.amt, 0)).toBe(credit);

  for (const b of st.balance) {
    expect(Number.isInteger(b.net)).toBe(true);
    expect(Number.isInteger(b.spent)).toBe(true);
    expect(Number.isInteger(b.paid)).toBe(true);
    expect(Number.isInteger(b.owed)).toBe(true);
  }
  for (const t of st.transfers) expect(Number.isInteger(t.amt)).toBe(true);
  for (const c of st.collectors ?? []) expect(Number.isInteger(c.amt)).toBe(true);
}

/** 1×1 PNG. 로컬 저장소 업로드 검사용 — EXIF 가 없으므로 촬영 시각은 업로드 시각으로 대체된다. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export function pngForm(name = "test.png"): FormData {
  const form = new FormData();
  form.append("file", new Blob([TINY_PNG], { type: "image/png" }), name);
  return form;
}
