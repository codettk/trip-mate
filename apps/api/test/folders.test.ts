/**
 * 폴더 · 공유 · 미디어 접근 제어.
 *
 * 공유는 TripMate 가 관리한다 — Drive 공유 링크를 밖으로 내보내지 않는다.
 * 뷰어는 공개된 **그 폴더의 미디어만** 본다. 조상 폴더의 토큰으로는 열리지 않는다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, GROUP_NAME, pngForm, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar;
let anon: Jar;
let gid: string;
let folders: any;

const tokenOf = (url: string): string => new URL(url).searchParams.get("t")!;

beforeAll(async () => {
  ctx = await bootstrap();
  jh = await ctx.login("지현");
  anon = ctx.jar();
  gid = ctx.groupId;
  folders = (await jh.fetch(`/api/groups/${gid}/folders`)).body;
}, 60_000);

afterAll(async () => {
  await ctx.close();
});

describe("폴더와 공유", () => {
  let day1f: any;
  let firstShareUrl: string;

  beforeAll(() => {
    day1f = folders.root.children.find((c: any) => c.name.includes("Day 1"));
  });

  it("루트 폴더 이름 = 모임 제목", () => {
    expect(folders.root.name).toBe(GROUP_NAME);
  });

  it("하위 폴더가 중첩된다 (깊이 제한 없음)", () => {
    expect(folders.root.children.some((c: any) => c.children.length > 0)).toBe(true);
  });

  it("공개 폴더에 shareUrl 이 있다", async () => {
    const fv = (await jh.fetch(`/api/groups/${gid}/folders/${day1f.id}`)).body;
    firstShareUrl = fv.folder.shareUrl;
    expect(typeof firstShareUrl).toBe("string");
    expect(firstShareUrl).toContain("/view/");
  });

  it("응답에 Drive 링크가 없다", async () => {
    const fv = await jh.fetch(`/api/groups/${gid}/folders/${day1f.id}`);
    const raw = JSON.stringify(fv.body);
    expect(raw).not.toContain("drive.google");
    expect(raw).not.toMatch(/driveFolderId|drive_folder_id/);
  });

  it("루트 폴더는 공개할 수 없다", async () => {
    const r = await jh.fetch(`/api/groups/${gid}/folders/${folders.root.id}/public`, {
      method: "PUT",
      body: JSON.stringify({ pub: true }),
    });
    expect(r.status).toBe(400);
  });

  it("비공개로 되돌리면 shareUrl 이 사라진다", async () => {
    const off = await jh.fetch(`/api/groups/${gid}/folders/${day1f.id}/public`, {
      method: "PUT",
      body: JSON.stringify({ pub: false }),
    });
    expect(off.body.shareUrl ?? off.body.folder?.shareUrl).toBe(null);
  });

  it("다시 공개하면 새 토큰이 나온다 (옛 링크 부활 없음)", async () => {
    const on = await jh.fetch(`/api/groups/${gid}/folders/${day1f.id}/public`, {
      method: "PUT",
      body: JSON.stringify({ pub: true }),
    });
    const newUrl = on.body.shareUrl ?? on.body.folder?.shareUrl;
    expect(typeof newUrl).toBe("string");
    expect(newUrl).not.toBe(firstShareUrl);
  });
});

describe("사진 업로드 → 미디어 접근 제어", () => {
  let parent: any; // Day 1 · 성산 (공개)
  let child: any; // 일출봉 (Day 1 의 하위, 비공개로 시작)
  let photo: any;
  let parentToken: string;
  let childToken: string;

  beforeAll(async () => {
    parent = folders.root.children.find((c: any) => c.name.includes("Day 1"));
    child = parent.children[0];

    // 조상 폴더는 공개 상태여야 "조상 토큰으로는 못 연다"를 확인할 수 있다.
    const on = await jh.fetch(`/api/groups/${gid}/folders/${parent.id}/public`, {
      method: "PUT",
      body: JSON.stringify({ pub: true }),
    });
    parentToken = tokenOf(on.body.shareUrl ?? on.body.folder.shareUrl);
  });

  it("업로드 대상은 지금 열어 둔 폴더다", async () => {
    const res = await jh.fetch(`/api/groups/${gid}/folders/${child.id}/photos`, {
      method: "POST",
      body: pngForm("일출봉.png"),
    });
    expect(res.status).toBe(200);
    expect(res.body.failed).toEqual([]);
    expect(res.body.uploaded.length).toBe(1);

    photo = res.body.uploaded[0];
    // 촬영 시각으로 자동 분류해 옮기지 않는다 — 요청한 폴더 그대로다
    expect(photo.folderId).toBe(child.id);
  });

  it("응답에 storage_key 나 Drive 링크가 없고 주소는 TripMate URL 이다", () => {
    expect(JSON.stringify(photo)).not.toMatch(/storage_?key|drive/i);
    expect(photo.url).toBe(`/api/media/${photo.id}`);
  });

  it("촬영 메타데이터가 없으면 업로드 시각을 촬영 시각으로 믿는다", () => {
    expect(photo.takenFallback).toBe(true);
    expect(photo.takenAt).toBe(photo.uploadedAt);
  });

  it("① 멤버 세션으로 /api/media/:id 200", async () => {
    expect((await jh.fetch(`/api/media/${photo.id}`)).status).toBe(200);
  });

  it("② 비로그인은 404", async () => {
    expect((await anon.fetch(`/api/media/${photo.id}`)).status).toBe(404);
  });

  it("③ 그 폴더를 공개하면 올바른 토큰으로 200", async () => {
    const on = await jh.fetch(`/api/groups/${gid}/folders/${child.id}/public`, {
      method: "PUT",
      body: JSON.stringify({ pub: true }),
    });
    childToken = tokenOf(on.body.shareUrl ?? on.body.folder.shareUrl);
    expect((await anon.fetch(`/api/media/${photo.id}?t=${childToken}`)).status).toBe(200);
  });

  it("④ 조상 폴더의 토큰으로는 404 (뷰어는 그 폴더의 미디어만 본다)", async () => {
    expect(parentToken).not.toBe(childToken);
    expect((await anon.fetch(`/api/media/${photo.id}?t=${parentToken}`)).status).toBe(404);
  });

  it("⑤ 비공개로 되돌리면 그 토큰으로 404", async () => {
    await jh.fetch(`/api/groups/${gid}/folders/${child.id}/public`, {
      method: "PUT",
      body: JSON.stringify({ pub: false }),
    });
    expect((await anon.fetch(`/api/media/${photo.id}?t=${childToken}`)).status).toBe(404);
    // 멤버는 폴더가 비공개여도 그대로 본다 (폴더별 권한 설정이 없다)
    expect((await jh.fetch(`/api/media/${photo.id}`)).status).toBe(200);
  });
});
