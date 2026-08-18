/**
 * 공유 뷰어 · 정산 공유 링크 — 밖으로 나가는 것을 통제하는 자리.
 *
 * 외부로 나가는 것은 미디어(사진·동영상)뿐이다. 문서·일정은 어떤 경우에도 나가지 않고,
 * 유일한 예외인 정산 공유 링크도 이름·금액·이체 목록까지다 (멤버 id 도 나가지 않는다).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, GROUP_NAME, pngForm, type Ctx, type Jar } from "./helpers.ts";

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

describe("공유 뷰어 (로그인 없음)", () => {
  let parentsTok: string;
  let matesTok: string;
  let day1: any;
  let sunrise: any;
  let receipt: any;
  let view: any;

  beforeAll(async () => {
    const walk = (n: any, name: string): any => {
      if (n.name.includes(name)) return n;
      for (const c of n.children) {
        const hit = walk(c, name);
        if (hit) return hit;
      }
      return null;
    };
    day1 = walk(folders.root, "Day 1");
    sunrise = walk(folders.root, "일출봉");
    receipt = walk(folders.root, "영수증");

    // 사진이 있어야 뷰어가 실제로 무엇을 내보내는지 확인할 수 있다.
    // 영수증에도 한 장 올린다 — 묶음 밖 폴더가 진짜로 막히는지 볼 대조군이다.
    for (const [fid, name] of [[day1.id, "성산.png"], [sunrise.id, "일출봉.png"], [receipt.id, "영수증.png"]] as const) {
      const up = await jh.fetch(`/api/groups/${gid}/folders/${fid}/photos`, {
        method: "POST",
        body: pngForm(name),
      });
      expect(up.status).toBe(200);
    }

    const list = (await jh.fetch(`/api/groups/${gid}/shares`)).body.shares;
    const tokenOf = (url: string): string => url.split("/view/")[1]!;
    parentsTok = tokenOf(list.find((x: any) => x.label === "부모님께").url);
    matesTok = tokenOf(list.find((x: any) => x.label === "동반 모임").url);

    view = await anon.fetch(`/api/view/${gid}/share/${parentsTok}`);
  }, 30_000);

  it("올바른 토큰이면 열린다", () => {
    expect(view.status).toBe(200);
  });

  it("묶음 이름·폴더·사진만 온다", () => {
    expect(typeof view.body.link?.label).toBe("string");
    expect(Array.isArray(view.body.photos)).toBe(true);
    expect(Array.isArray(view.body.folders)).toBe(true);
  });

  it("사진 주소는 TripMate URL 이다 (Drive 링크·서명 URL 없음)", async () => {
    const deep = await anon.fetch(
      `/api/view/${gid}/share/${parentsTok}/${encodeURIComponent(sunrise.slug)}`,
    );
    expect(deep.status).toBe(200);
    expect(deep.body.photos.length).toBe(1);
    expect(deep.body.photos[0].url).toBe(`/api/media/${deep.body.photos[0].id}?t=${parentsTok}`);
  });

  it("묶음에 담긴 폴더만 목록에 나온다 — 나머지는 존재를 알리지 않는다", async () => {
    const raw = JSON.stringify(view.body);
    // 영수증은 어느 묶음에도 없다. 이름조차 나오면 안 된다.
    expect(raw).not.toContain("영수증");
    expect(raw).not.toContain("우도");
  });

  it("묶음 밖 폴더는 slug 로 직접 접근해도 404 (신·구 주소 모두)", async () => {
    const a = await anon.fetch(`/api/view/${gid}/share/${parentsTok}/${encodeURIComponent(receipt.slug)}`);
    expect(a.status).toBe(404);
    const b = await anon.fetch(`/api/view/${gid}/folder/${encodeURIComponent(receipt.slug)}?t=${parentsTok}`);
    expect(b.status).toBe(404);
  });

  it("브레드크럼은 묶음 루트까지만이고 바깥 조상이 없다", async () => {
    const deep = await anon.fetch(
      `/api/view/${gid}/share/${parentsTok}/${encodeURIComponent(sunrise.slug)}`,
    );
    const names = deep.body.breadcrumb.map((c: any) => c.name);
    // 루트(모임 제목)는 묶음에 담기지 않았으므로 경로에 나오지 않는다
    expect(names).not.toContain(GROUP_NAME);
    expect(names[names.length - 1]).toContain("일출봉");
  });

  it("문서·일정이 없다", () => {
    const raw = JSON.stringify(view.body);
    expect(raw).not.toContain("docs");
    expect(raw).not.toContain("items");
    expect(raw).not.toContain("계획서");
  });

  it("storage_key / drive id 가 없다", () => {
    expect(JSON.stringify(view.body)).not.toMatch(/storage_?key|driveFile|drive_folder/i);
  });

  it("폴더 id 를 내보내지 않는다 — 이동은 slug 로만 한다", () => {
    for (const f of view.body.folders) expect(f.id).toBeUndefined();
  });

  it("틀린 토큰이면 404 (존재를 알려주지 않는다)", async () => {
    expect((await anon.fetch(`/api/view/${gid}/share/wrongtoken`)).status).toBe(404);
    expect((await anon.fetch(`/api/view/${gid}/share/`)).status).toBe(404);
  });

  it("다른 묶음의 폴더를 이 토큰으로 열 수 없다", async () => {
    const drone = (await jh.fetch(`/api/groups/${gid}/folders`)).body.root.children.find((c: any) =>
      c.name.includes("드론샷"),
    );
    const r = await anon.fetch(`/api/view/${gid}/share/${parentsTok}/${encodeURIComponent(drone.slug)}`);
    expect(r.status).toBe(404);
    // 그 폴더의 진짜 묶음 토큰으로는 열린다
    const ok = await anon.fetch(`/api/view/${gid}/share/${matesTok}/${encodeURIComponent(drone.slug)}`);
    expect(ok.status).toBe(200);
  });

  it("옛 주소도 그대로 열린다 — 이미 뿌린 링크가 죽으면 안 된다", async () => {
    const r = await anon.fetch(`/api/view/${gid}/folder/${encodeURIComponent(day1.slug)}?t=${parentsTok}`);
    expect(r.status).toBe(200);
    expect(r.body.folder.slug).toBe(day1.slug);
  });

  it("멤버가 열어도 내용은 그대로 오고 memberView 로 알려 준다", async () => {
    const asMember = await jh.fetch(`/api/view/${gid}/share/${parentsTok}`);
    expect(asMember.status).toBe(200);
    // 자동으로 앱에 보내지 않는다 — 방장이 외부인 시점을 확인하려고 여는 경우가 있다
    expect(asMember.body.memberView).toBe(true);
    expect(asMember.body.folders.length).toBe(view.body.folders.length);
    // 밖에서 열면 false 다
    expect(view.body.memberView).toBe(false);
  });

  it("공유 뷰어로 미디어를 볼 수 있다", async () => {
    const deep = await anon.fetch(
      `/api/view/${gid}/share/${parentsTok}/${encodeURIComponent(sunrise.slug)}`,
    );
    expect((await anon.fetch(deep.body.photos[0].url)).status).toBe(200);
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
