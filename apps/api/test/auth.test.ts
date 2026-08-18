/**
 * 인증 · 권한.
 * 로그인은 카카오 하나만 지원한다 (테스트에서는 AUTH_MODE=mock 으로 같은 세션 경로를 탄다).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar;
let anon: Jar;

beforeAll(async () => {
  ctx = await bootstrap();
  jh = await ctx.login("지현");
  anon = ctx.jar();
}, 60_000);

afterAll(async () => {
  await ctx.close();
});

describe("인증", () => {
  it("로그인 후 me", async () => {
    const r = await jh.fetch("/api/auth/me");
    expect(r.body.user.name).toBe("지현");
  });

  it("비로그인 me 는 null", async () => {
    const r = await anon.fetch("/api/auth/me");
    expect(r.body.user).toBe(null);
  });

  it("로그아웃하면 세션이 끊긴다", async () => {
    const tmp = await ctx.login("민수");
    expect((await tmp.fetch("/api/auth/me")).body.user.name).toBe("민수");
    expect((await tmp.fetch("/api/auth/logout", { method: "POST" })).status).toBe(200);
    expect((await tmp.fetch("/api/auth/me")).body.user).toBe(null);
  });
});

describe("권한 — 모임 밖 사람", () => {
  let stranger: Jar;

  beforeAll(async () => {
    stranger = await ctx.login("낯선사람");
  });

  it("모임 상세 403/404", async () => {
    expect([403, 404]).toContain((await stranger.fetch(`/api/groups/${ctx.groupId}`)).status);
  });

  it("정산 403/404", async () => {
    expect([403, 404]).toContain(
      (await stranger.fetch(`/api/groups/${ctx.groupId}/settlement`)).status,
    );
  });

  it("일정 403/404", async () => {
    expect([403, 404]).toContain(
      (await stranger.fetch(`/api/groups/${ctx.groupId}/itinerary`)).status,
    );
  });

  it("문서 403/404", async () => {
    expect([403, 404]).toContain((await stranger.fetch(`/api/groups/${ctx.groupId}/docs`)).status);
  });

  it("비로그인 정산 401", async () => {
    expect((await anon.fetch(`/api/groups/${ctx.groupId}/settlement`)).status).toBe(401);
  });
});
