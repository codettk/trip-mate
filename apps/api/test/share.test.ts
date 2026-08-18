/**
 * 공개 뷰어 · 정산 공유 링크 — 밖으로 나가는 것을 통제하는 자리.
 *
 * 외부로 나가는 것은 미디어(사진·동영상)뿐이다. 문서·일정은 어떤 경우에도 나가지 않고,
 * 유일한 예외인 정산 공유 링크도 이름·금액·이체 목록까지다 (멤버 id 도 나가지 않는다).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, pngForm, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar;
let anon: Jar;
let gid: string;
let folders: any;

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

describe("공개 뷰어 (로그인 없음)", () => {
  let slug: string;
  let tok: string;
  let view: any;

  beforeAll(async () => {
    const day1f = folders.root.children.find((c: any) => c.name.includes("Day 1"));
    // 사진이 한 장은 있어야 뷰어가 실제로 무엇을 내보내는지 확인할 수 있다.
    const up = await jh.fetch(`/api/groups/${gid}/folders/${day1f.id}/photos`, {
      method: "POST",
      body: pngForm("성산.png"),
    });
    expect(up.status).toBe(200);

    const fv = (await jh.fetch(`/api/groups/${gid}/folders/${day1f.id}`)).body;
    const u = new URL(fv.folder.shareUrl);
    slug = u.pathname.split("/").pop()!;
    tok = u.searchParams.get("t")!;
    view = await anon.fetch(`/api/view/${gid}/folder/${slug}?t=${tok}`);
  });

  it("올바른 토큰이면 열린다", () => {
    expect(view.status).toBe(200);
  });

  it("폴더 이름과 사진만 온다", () => {
    expect(typeof view.body.folder?.name).toBe("string");
    expect(Array.isArray(view.body.photos)).toBe(true);
    expect(view.body.photos.length).toBe(1);
  });

  it("사진 주소는 TripMate URL 이다 (Drive 링크·서명 URL 없음)", () => {
    expect(view.body.photos[0].url).toBe(`/api/media/${view.body.photos[0].id}?t=${tok}`);
  });

  it("하위 폴더 목록이 없다", () => {
    expect(view.body.children).toBeFalsy();
    expect(view.body.breadcrumb).toBeFalsy();
  });

  it("문서·일정이 없다", () => {
    const raw = JSON.stringify(view.body);
    expect(raw).not.toContain("docs");
    expect(raw).not.toContain("items");
  });

  it("storage_key / drive id 가 없다", () => {
    expect(JSON.stringify(view.body)).not.toMatch(/storage_?key|driveFile|drive_folder/i);
  });

  it("틀린 토큰이면 404 (존재를 알려주지 않는다)", async () => {
    const bad = await anon.fetch(`/api/view/${gid}/folder/${slug}?t=wrongtoken`);
    expect(bad.status).toBe(404);
  });

  it("다른 폴더를 같은 토큰으로 열 수 없다", async () => {
    const priv = folders.root.children.find((c: any) => c.name.includes("Day 2"));
    const r = await anon.fetch(`/api/view/${gid}/folder/${priv.slug}?t=${tok}`);
    expect(r.status).toBe(404);
  });

  it("공개 뷰어로 미디어를 볼 수 있다", async () => {
    const r = await anon.fetch(view.body.photos[0].url);
    expect(r.status).toBe(200);
  });
});

describe("정산 공유 링크", () => {
  let stok: string;
  let outsider: any;

  beforeAll(async () => {
    const share = (await jh.fetch(`/api/groups/${gid}/settlement/share`)).body;
    expect(share.url).toContain("/settle/");
    stok = share.url.split("/settle/")[1];
    outsider = await anon.fetch(`/api/view/${gid}/settle/${stok}`);
  });

  it("공유 링크가 하나 발급된다", () => {
    expect(typeof stok).toBe("string");
    expect(stok.length).toBeGreaterThan(0);
  });

  it("멤버가 열면 앱 정산 화면으로 보낸다", async () => {
    const memberView = await jh.fetch(`/api/view/${gid}/settle/${stok}`);
    expect(memberView.body.memberView).toBe(true);
  });

  it("밖에서 열면 읽기 전용 뷰어", () => {
    expect(outsider.status).toBe(200);
    expect(outsider.body.memberView).toBe(false);
  });

  it("이름·금액·이체만 온다", () => {
    expect(Array.isArray(outsider.body.balance)).toBe(true);
    expect(Array.isArray(outsider.body.transfers)).toBe(true);
  });

  it("멤버 id 가 새지 않는다", () => {
    expect(outsider.body.balance.some((b: any) => "id" in b)).toBe(false);
  });

  it("사진·문서·일정이 없다", () => {
    expect(JSON.stringify(outsider.body)).not.toMatch(/photos|docs|items|folder/i);
  });

  it("틀린 토큰이면 404", async () => {
    expect((await anon.fetch(`/api/view/${gid}/settle/nonsense`)).status).toBe(404);
  });
});
