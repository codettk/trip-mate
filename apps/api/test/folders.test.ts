/**
 * 폴더 · 공유 묶음 · 미디어 접근 제어.
 *
 * 공유는 TripMate 가 관리한다 — Drive 공유 링크를 밖으로 내보내지 않는다.
 * **공유 단위는 폴더가 아니라 묶음이다.** 링크 하나가 여러 폴더를 담을 수 있고,
 * 뷰어는 그 묶음에 담긴 폴더의 미디어만 본다.
 *
 * 이 파일이 겨누는 것은 하나다 — **묶음에 없는 폴더의 사진이 그 토큰으로 열리면 유출이다.**
 * 시드에는 그 확인을 위한 대조군이 있다: `영수증` 폴더는 어느 묶음에도 담기지 않았다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, GROUP_NAME, pngForm, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar;
let anon: Jar;
let gid: string;
let folders: any;

/** 묶음 주소에서 토큰만 뽑는다. `…/{gid}/view/{token}` */
const tokenOf = (url: string): string => url.split("/view/")[1]!;

const tree = async (): Promise<any> => (await jh.fetch(`/api/groups/${gid}/folders`)).body;
const shares = async (): Promise<any[]> => (await jh.fetch(`/api/groups/${gid}/shares`)).body.shares;
const find = (root: any, name: string): any => {
  const walk = (n: any): any => {
    if (n.name.includes(name)) return n;
    for (const c of n.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
};

beforeAll(async () => {
  ctx = await bootstrap();
  jh = await ctx.login("지현");
  anon = ctx.jar();
  gid = ctx.groupId;
  folders = await tree();
}, 60_000);

afterAll(async () => {
  await ctx.close();
});

describe("폴더", () => {
  it("루트 폴더 이름 = 모임 제목", () => {
    expect(folders.root.name).toBe(GROUP_NAME);
  });

  it("하위 폴더가 중첩된다 (깊이 제한 없음)", () => {
    expect(folders.root.children.some((c: any) => c.children.length > 0)).toBe(true);
  });

  it("폴더 응답에 pub·token 이 없다 — 공유는 폴더에 붙지 않는다", () => {
    const raw = JSON.stringify(folders);
    expect(raw).not.toMatch(/"pub"|"shareUrl"|"token"/);
    // 대신 이 폴더를 담고 있는 묶음 id 들이 온다
    expect(Array.isArray(folders.root.sharedIn)).toBe(true);
  });

  it("응답에 Drive 링크·저장소 식별자가 없다", async () => {
    const day1 = find(folders.root, "Day 1");
    const fv = await jh.fetch(`/api/groups/${gid}/folders/${day1.id}`);
    const raw = JSON.stringify(fv.body);
    expect(raw).not.toContain("drive.google");
    expect(raw).not.toMatch(/driveFolderId|drive_folder_id|storage_?key/);
  });

  it("폴더별 공개 토글 라우트가 사라졌다", async () => {
    const r = await jh.fetch(`/api/groups/${gid}/folders/${folders.root.id}/public`, {
      method: "PUT",
      body: JSON.stringify({ pub: true }),
    });
    // 라우트 자체가 없다 — 공유는 묶음으로만 만든다
    expect(r.status).toBe(404);
  });

  it("폴더를 자기 자손 밑으로 옮기려 하면 400 이고 이유를 준다", async () => {
    const day1 = find(folders.root, "Day 1");
    const child = day1.children[0];
    const r = await jh.fetch(`/api/groups/${gid}/folders/${day1.id}`, {
      method: "PATCH",
      body: JSON.stringify({ parentId: child.id }),
    });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain("하위 폴더");
  });

  it("루트 폴더는 옮길 수 없다", async () => {
    const day1 = find(folders.root, "Day 1");
    const r = await jh.fetch(`/api/groups/${gid}/folders/${folders.root.id}`, {
      method: "PATCH",
      body: JSON.stringify({ parentId: day1.id }),
    });
    expect(r.status).toBe(400);
  });
});

describe("공유 묶음", () => {
  it("시드에 묶음 둘이 있고, 담긴 폴더 수가 하위까지 세어진다", async () => {
    const list = await shares();
    expect(list.length).toBe(2);

    const parents = list.find((s) => s.label === "부모님께")!;
    // Day 1 을 하위까지 담았다 → Day 1 + 일출봉 + 저녁 = 3개.
    // 이 숫자가 공유 모달이 보여 주는 값과 같아야 한다 (같은 resolveShared 를 쓴다).
    expect(parents.entries).toEqual([{ folderId: expect.any(String), includeDescendants: true }]);
    expect(parents.folderCount).toBe(3);

    const mates = list.find((s) => s.label === "동반 모임")!;
    expect(mates.folderCount).toBe(1);
  });

  it("묶음 응답에 토큰이 url 안에만 있고 저장소 식별자가 없다", async () => {
    const list = await shares();
    const raw = JSON.stringify(list);
    expect(raw).not.toContain("drive.google");
    expect(raw).not.toMatch(/drive_folder_id|storage_?key/);
    expect(raw).not.toMatch(/"token"\s*:/); // 토큰을 따로 내보내지 않는다
    for (const s of list) expect(s.url).toContain("/view/");
  });

  it("담긴 폴더에는 sharedIn 이 붙고, 담기지 않은 폴더는 비어 있다", async () => {
    const t = await tree();
    const list = await shares();
    const parents = list.find((s) => s.label === "부모님께")!;

    const day1 = find(t.root, "Day 1");
    const sunrise = find(t.root, "일출봉");
    const receipt = find(t.root, "영수증");

    expect(day1.sharedIn).toContain(parents.id);
    // includeDescendants 로 딸려 나간 폴더도 표시된다 — 모르고 새면 안 된다
    expect(sunrise.sharedIn).toContain(parents.id);
    // 대조군: 어느 묶음에도 없다
    expect(receipt.sharedIn).toEqual([]);
  });

  it("같은 폴더가 두 번 오면 좁은 쪽(false)으로 합친다", async () => {
    const day1 = find(folders.root, "Day 1");
    const made = await jh.fetch(`/api/groups/${gid}/shares`, {
      method: "POST",
      body: JSON.stringify({
        label: "중복",
        entries: [
          { folderId: day1.id, includeDescendants: true },
          { folderId: day1.id, includeDescendants: false },
        ],
      }),
    });
    expect(made.status).toBe(200);
    // 넓은 쪽을 고르면 모달이 보여 준 개수보다 많이 나간다
    expect(made.body.share.entries).toEqual([{ folderId: day1.id, includeDescendants: false }]);
    expect(made.body.share.folderCount).toBe(1);

    await jh.fetch(`/api/groups/${gid}/shares/${made.body.share.id}`, { method: "DELETE" });
  });
});

describe("사진 업로드 → 미디어 접근 제어", () => {
  let day1: any; // 부모님께 묶음에 하위까지 담겨 있다
  let sunrise: any; // Day 1 의 하위 → 자동 포함
  let receipt: any; // 어느 묶음에도 없다 (대조군)
  let inside: any; // day1 에 올린 사진
  let deep: any; // sunrise 에 올린 사진
  let outside: any; // receipt 에 올린 사진
  let parentsToken: string;
  let matesToken: string;

  beforeAll(async () => {
    const t = await tree();
    day1 = find(t.root, "Day 1");
    sunrise = find(t.root, "일출봉");
    receipt = find(t.root, "영수증");

    const list = await shares();
    parentsToken = tokenOf(list.find((s) => s.label === "부모님께")!.url);
    matesToken = tokenOf(list.find((s) => s.label === "동반 모임")!.url);

    const up = async (fid: string, name: string): Promise<any> => {
      const r = await jh.fetch(`/api/groups/${gid}/folders/${fid}/photos`, {
        method: "POST",
        body: pngForm(name),
      });
      expect(r.status).toBe(200);
      expect(r.body.failed).toEqual([]);
      return r.body.uploaded[0];
    };
    inside = await up(day1.id, "성산.png");
    deep = await up(sunrise.id, "일출봉.png");
    outside = await up(receipt.id, "영수증.png");
  }, 30_000);

  it("업로드 대상은 지금 열어 둔 폴더다 (자동 분류로 옮기지 않는다)", () => {
    expect(inside.folderId).toBe(day1.id);
    expect(deep.folderId).toBe(sunrise.id);
  });

  it("응답에 storage_key 나 Drive 링크가 없고 주소는 TripMate URL 이다", () => {
    expect(JSON.stringify(inside)).not.toMatch(/storage_?key|drive/i);
    expect(inside.url).toBe(`/api/media/${inside.id}`);
  });

  it("촬영 메타데이터가 없으면 업로드 시각을 촬영 시각으로 믿는다", () => {
    expect(inside.takenFallback).toBe(true);
    expect(inside.takenAt).toBe(inside.uploadedAt);
  });

  it("① 멤버 세션이면 묶음과 무관하게 200 — 멤버는 모든 폴더를 본다", async () => {
    for (const p of [inside, deep, outside]) {
      expect((await jh.fetch(`/api/media/${p.id}`)).status).toBe(200);
    }
  });

  it("② 비로그인·토큰 없음은 404", async () => {
    expect((await anon.fetch(`/api/media/${inside.id}`)).status).toBe(404);
  });

  it("③ 묶음에 담긴 폴더의 사진은 그 토큰으로 200", async () => {
    expect((await anon.fetch(`/api/media/${inside.id}?t=${parentsToken}`)).status).toBe(200);
  });

  it("④ includeDescendants 로 딸려 나간 하위 폴더 사진도 200", async () => {
    expect((await anon.fetch(`/api/media/${deep.id}?t=${parentsToken}`)).status).toBe(200);
  });

  it("⑤ 묶음에 없는 폴더의 사진은 어떤 토큰으로도 404", async () => {
    // 이게 이 파일에서 제일 중요한 검증이다
    for (const t of [parentsToken, matesToken, "위조토큰", ""]) {
      expect((await anon.fetch(`/api/media/${outside.id}?t=${t}`)).status).toBe(404);
    }
  });

  it("⑥ 다른 묶음의 토큰으로는 404", async () => {
    expect((await anon.fetch(`/api/media/${inside.id}?t=${matesToken}`)).status).toBe(404);
  });

  it("⑦ 묶음에서 폴더를 빼면 그 폴더만 죽고 링크 주소는 산다", async () => {
    const list = await shares();
    const parents = list.find((s) => s.label === "부모님께")!;

    // 하위 포함을 끄면 일출봉이 빠진다. 토큰은 그대로여야 한다.
    const off = await jh.fetch(`/api/groups/${gid}/shares/${parents.id}`, {
      method: "PATCH",
      body: JSON.stringify({ entries: [{ folderId: day1.id, includeDescendants: false }] }),
    });
    expect(off.status).toBe(200);
    expect(tokenOf(off.body.share.url)).toBe(parentsToken);

    expect((await anon.fetch(`/api/media/${deep.id}?t=${parentsToken}`)).status).toBe(404);
    expect((await anon.fetch(`/api/media/${inside.id}?t=${parentsToken}`)).status).toBe(200);

    // 시드 상태로 되돌린다
    await jh.fetch(`/api/groups/${gid}/shares/${parents.id}`, {
      method: "PATCH",
      body: JSON.stringify({ entries: [{ folderId: day1.id, includeDescendants: true }] }),
    });
  });

  it("⑧ includeDescendants 묶음 아래 새 폴더는 자동으로 포함된다", async () => {
    const made = await jh.fetch(`/api/groups/${gid}/folders`, {
      method: "POST",
      body: JSON.stringify({ parentId: day1.id, name: "나중에 만든 폴더" }),
    });
    expect(made.status).toBe(200);
    // 만드는 그 순간 이미 공유 중이다 — 화면이 배지로 알려야 하는 이유다
    expect(made.body.folder.sharedIn.length).toBe(1);

    const shot = await jh.fetch(`/api/groups/${gid}/folders/${made.body.folder.id}/photos`, {
      method: "POST",
      body: pngForm("나중.png"),
    });
    const p = shot.body.uploaded[0];
    expect((await anon.fetch(`/api/media/${p.id}?t=${parentsToken}`)).status).toBe(200);

    await jh.fetch(`/api/groups/${gid}/folders/${made.body.folder.id}?force=true`, {
      method: "DELETE",
    });
  });

  it("⑨ 폴더를 묶음 밖으로 옮기면 그 폴더 사진이 즉시 404", async () => {
    // 일출봉을 영수증 밑으로 옮긴다 → 부모님께 묶음에서 빠진다
    const moved = await jh.fetch(`/api/groups/${gid}/folders/${sunrise.id}`, {
      method: "PATCH",
      body: JSON.stringify({ parentId: receipt.id }),
    });
    expect(moved.status).toBe(200);
    expect(moved.body.folder.sharedIn).toEqual([]);
    expect((await anon.fetch(`/api/media/${deep.id}?t=${parentsToken}`)).status).toBe(404);

    // 되돌린다
    await jh.fetch(`/api/groups/${gid}/folders/${sunrise.id}`, {
      method: "PATCH",
      body: JSON.stringify({ parentId: day1.id }),
    });
    expect((await anon.fetch(`/api/media/${deep.id}?t=${parentsToken}`)).status).toBe(200);
  });

  it("⑩ 토큰을 재발급하면 옛 토큰이 죽는다", async () => {
    const list = await shares();
    const mates = list.find((s) => s.label === "동반 모임")!;
    const before = tokenOf(mates.url);

    const rot = await jh.fetch(`/api/groups/${gid}/shares/${mates.id}/rotate`, { method: "POST" });
    expect(rot.status).toBe(200);
    const after = tokenOf(rot.body.share.url);
    expect(after).not.toBe(before);

    // 예전에 뿌린 링크가 되살아나면 안 되므로 토큰을 id 에서 파생시키지 않는다
    expect((await anon.fetch(`/api/view/${gid}/share/${before}`)).status).toBe(404);
    expect((await anon.fetch(`/api/view/${gid}/share/${after}`)).status).toBe(200);
  });

  it("⑪ 묶음을 중지하면 링크 전체가 죽는다", async () => {
    const made = await jh.fetch(`/api/groups/${gid}/shares`, {
      method: "POST",
      body: JSON.stringify({
        label: "임시",
        entries: [{ folderId: day1.id, includeDescendants: false }],
      }),
    });
    const t = tokenOf(made.body.share.url);
    expect((await anon.fetch(`/api/media/${inside.id}?t=${t}`)).status).toBe(200);

    await jh.fetch(`/api/groups/${gid}/shares/${made.body.share.id}`, { method: "DELETE" });
    expect((await anon.fetch(`/api/media/${inside.id}?t=${t}`)).status).toBe(404);
    expect((await anon.fetch(`/api/view/${gid}/share/${t}`)).status).toBe(404);
  });

  it("사진 이름·촬영 시각을 고치고 되돌릴 수 있다", async () => {
    const set = await jh.fetch(`/api/groups/${gid}/photos/${inside.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "성산일출봉.png", takenAt: "2026-09-12T07:30:00.000Z" }),
    });
    expect(set.status).toBe(200);
    expect(set.body.photo.name).toBe("성산일출봉.png");
    expect(set.body.photo.takenFallback).toBe(false);

    // 잘못 넣은 값을 되돌릴 방법이 있어야 한다
    const clear = await jh.fetch(`/api/groups/${gid}/photos/${inside.id}`, {
      method: "PATCH",
      body: JSON.stringify({ takenAt: null }),
    });
    expect(clear.body.photo.takenFallback).toBe(true);
    expect(clear.body.photo.takenAt).toBe(clear.body.photo.uploadedAt);
  });

  it("여러 장을 한 번에 옮기고, 막힌 것은 이유와 함께 돌려준다", async () => {
    const r = await jh.fetch(`/api/groups/${gid}/photos/move`, {
      method: "POST",
      body: JSON.stringify({ ids: [inside.id, "00000000-0000-0000-0000-000000000000"], folderId: receipt.id }),
    });
    expect(r.status).toBe(200);
    expect(r.body.moved.length).toBe(1);
    expect(r.body.moved[0].folderId).toBe(receipt.id);
    // 부분 실패를 통째 실패로 만들지 않는다
    expect(r.body.failed.length).toBe(1);
    expect(typeof r.body.failed[0].reason).toBe("string");

    // 묶음 밖으로 나갔으므로 그 토큰으로는 더 이상 열리지 않는다
    expect((await anon.fetch(`/api/media/${inside.id}?t=${parentsToken}`)).status).toBe(404);
  });
});
