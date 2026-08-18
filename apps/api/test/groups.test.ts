/**
 * 여행 모임 — 모임이 최상위 단위다.
 * 일차는 기간에서 자동 생성되고, 나간 멤버는 행이 지워지지 않는다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, GROUP_NAME, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar;
let gid: string;
let detail: any;

beforeAll(async () => {
  ctx = await bootstrap();
  jh = await ctx.login("지현");
  gid = ctx.groupId;
  detail = (await jh.fetch(`/api/groups/${gid}`)).body;
}, 60_000);

afterAll(async () => {
  await ctx.close();
});

describe("모임", () => {
  it("시드 모임이 보인다", async () => {
    const gl = await jh.fetch("/api/groups");
    expect(gl.body.groups.some((x: any) => x.name === GROUP_NAME)).toBe(true);
  });

  it("방장은 지현", async () => {
    const gl = await jh.fetch("/api/groups");
    expect(gl.body.groups.find((x: any) => x.name === GROUP_NAME).role).toBe("owner");
  });

  it("일차 5개 자동 생성", () => {
    expect(detail.days.length).toBe(5);
  });

  it("시드 멤버 5명이 모두 남아 있다 (나간 멤버 포함)", () => {
    const names = detail.members.map((m: any) => m.name);
    for (const n of ["지현", "민수", "수아", "윤호", "기영"]) expect(names).toContain(n);
    expect(detail.members.length).toBe(5);
  });

  it("기영은 나간 멤버", () => {
    expect(detail.members.find((m: any) => m.name === "기영").left).toBe(true);
  });

  it("모임 응답에 정산 공유 토큰이 없다", () => {
    expect("settleToken" in detail.group).toBe(false);
    expect("settle_token" in detail.group).toBe(false);
  });

  // Drive 공유 링크·서명 URL 은 물론이고, 저장소 폴더 id 도 내보내지 않는다.
  // 화면이 쓰지 않는 값이라 브라우저에 흘려 둘 이유가 없다.
  it("모임 응답에 Drive 링크도 저장소 id 도 없다", () => {
    expect(JSON.stringify(detail)).not.toContain("drive.google");
    expect(JSON.stringify(detail)).not.toMatch(/driveFolderId|drive_folder_id/);
  });
});

describe("나가기 — 정산에는 남는다", () => {
  let stranger: Jar;
  let strangerMemberId: string;

  beforeAll(async () => {
    stranger = await ctx.login("낯선사람");
    const inv = (await jh.fetch(`/api/groups/${gid}/invite`, { method: "POST" })).body;
    const acc = await stranger.fetch(`/api/invites/${inv.code}/accept`, { method: "POST" });
    expect(acc.status).toBe(200);
    strangerMemberId = (await stranger.fetch(`/api/groups/${gid}`)).body.me.memberId;
  });

  it("본인은 나갈 수 있다", async () => {
    const left = await stranger.fetch(`/api/groups/${gid}/members/${strangerMemberId}`, {
      method: "DELETE",
    });
    expect(left.status).toBe(200);
  });

  it("멤버 행이 지워지지 않는다", async () => {
    const after = (await jh.fetch(`/api/groups/${gid}/members`)).body.members;
    expect(after.some((m: any) => m.name === "낯선사람" && m.left === true)).toBe(true);
  });

  it("나간 사람은 더 이상 접근 못 한다", async () => {
    expect([403, 404]).toContain((await stranger.fetch(`/api/groups/${gid}/itinerary`)).status);
  });

  it("방장은 위임 없이 못 나간다", async () => {
    const r = await jh.fetch(`/api/groups/${gid}/members/${detail.me.memberId}`, {
      method: "DELETE",
    });
    expect(r.status).toBe(409);
  });
});

describe("기간 변경 — 일차는 자동으로 따라온다", () => {
  it("일정이 남은 날짜를 빼려 하면 409", async () => {
    const shrink = await jh.fetch(`/api/groups/${gid}`, {
      method: "PATCH",
      body: JSON.stringify({ start: "2026-09-13", end: "2026-09-16" }),
    });
    expect(shrink.status).toBe(409);
  });

  it("늘리면 일차가 자동으로 늘어난다", async () => {
    const grow = await jh.fetch(`/api/groups/${gid}`, {
      method: "PATCH",
      body: JSON.stringify({ start: "2026-09-12", end: "2026-09-17" }),
    });
    expect(grow.status).toBe(200);
    expect((await jh.fetch(`/api/groups/${gid}`)).body.days.length).toBe(6);

    // 되돌린다
    const back = await jh.fetch(`/api/groups/${gid}`, {
      method: "PATCH",
      body: JSON.stringify({ start: "2026-09-12", end: "2026-09-16" }),
    });
    expect(back.status).toBe(200);
    expect((await jh.fetch(`/api/groups/${gid}`)).body.days.length).toBe(5);
  });
});
