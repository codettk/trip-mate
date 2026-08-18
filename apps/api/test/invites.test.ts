/**
 * 초대 — 발급 후 30분만 유효하고, 그 안에 들어오면 승인 절차 없이 즉시 멤버가 된다.
 * 다시 발급하면 그 순간 이전 링크는 죽는다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, GROUP_NAME, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar; // 방장
let ms: Jar; // 일반 멤버
let anon: Jar;
let stranger: Jar;
let gid: string;

let inv1: any;
let inv2: any;

beforeAll(async () => {
  ctx = await bootstrap();
  jh = await ctx.login("지현");
  ms = await ctx.login("민수");
  stranger = await ctx.login("낯선사람");
  anon = ctx.jar();
  gid = ctx.groupId;
}, 60_000);

afterAll(async () => {
  await ctx.close();
});

describe("초대 — 30분", () => {
  it("방장이 아니면 초대 발급 403", async () => {
    const r = await ms.fetch(`/api/groups/${gid}/invite`, { method: "POST" });
    expect(r.status).toBe(403);
  });

  it("초대 링크 발급", async () => {
    inv1 = (await jh.fetch(`/api/groups/${gid}/invite`, { method: "POST" })).body;
    expect(inv1.code).toBeTruthy();
    expect(inv1.url).toBeTruthy();
  });

  it("30분 유효", () => {
    const ttl = new Date(inv1.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(30 * 60 * 1000 + 5000);
  });

  it("로그인 없이 미리보기 가능", async () => {
    const peek = (await anon.fetch(`/api/invites/${inv1.code}`)).body;
    expect(peek.valid).toBe(true);
    expect(peek.group.name).toBe(GROUP_NAME);
  });

  it("다시 발급하면 코드가 바뀐다", async () => {
    inv2 = (await jh.fetch(`/api/groups/${gid}/invite`, { method: "POST" })).body;
    expect(inv2.code).not.toBe(inv1.code);
  });

  it("이전 링크는 즉시 죽는다", async () => {
    const old = (await anon.fetch(`/api/invites/${inv1.code}`)).body;
    expect(old.valid).toBe(false);
  });

  it("승인 절차 없이 즉시 멤버", async () => {
    const acc = await stranger.fetch(`/api/invites/${inv2.code}/accept`, { method: "POST" });
    expect(acc.status).toBe(200);
    expect(acc.body.groupId).toBe(gid);
  });

  it("이제 모임이 보인다", async () => {
    expect((await stranger.fetch(`/api/groups/${gid}`)).status).toBe(200);
  });

  it("죽은 링크로는 못 들어온다", async () => {
    const dead = await stranger.fetch(`/api/invites/${inv1.code}/accept`, { method: "POST" });
    expect([404, 410]).toContain(dead.status);
  });
});
