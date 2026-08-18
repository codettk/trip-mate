/**
 * 문서 — 모임 멤버 전용이다. 외부 공유 버튼도, 공개 토글도 없다.
 * 블록을 얹는 자유 문서이며 CRUD 가 전부 있고, 동시 수정은 낙관적 잠금으로 막는다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type Ctx, type Jar } from "./helpers.ts";

let ctx: Ctx;
let jh: Jar;
let gid: string;
let doc: any;

beforeAll(async () => {
  ctx = await bootstrap();
  jh = await ctx.login("지현");
  gid = ctx.groupId;
}, 60_000);

afterAll(async () => {
  await ctx.close();
});

describe("문서 — 외부 공유 없음", () => {
  it("시드 문서 1개", async () => {
    const docs = (await jh.fetch(`/api/groups/${gid}/docs`)).body;
    expect(docs.docs.length).toBe(1);
    expect(docs.docs[0].title).toBe("제주 계획서");
    doc = (await jh.fetch(`/api/groups/${gid}/docs/${docs.docs[0].id}`)).body;
  });

  it("블록 3개", () => {
    expect(doc.blocks.length).toBe(3);
  });

  it("문서에 공개 토글이 없다", () => {
    expect(JSON.stringify(doc)).not.toMatch(/"pub"|shareUrl|"token"/);
  });

  it("최신 버전이면 저장된다", async () => {
    const bump = await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "제주 계획서 v2", version: doc.doc.version }),
    });
    expect(bump.status).toBe(200);
    doc.doc.nextVersion = bump.body.doc.version;
  });

  it("같은 버전으로 다시 저장하면 409 (다른 사람이 먼저 저장)", async () => {
    const stale = await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "동시에 고친 제목", version: doc.doc.version }),
    });
    expect(stale.status).toBe(409);

    // 제목을 되돌린다
    await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "제주 계획서", version: doc.doc.nextVersion }),
    });
  });
});

describe("블록 CRUD", () => {
  let bid: string;
  let settleBid: string;

  it("블록 추가", async () => {
    const blk = await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}/blocks`, {
      method: "POST",
      body: JSON.stringify({ kind: "memo" }),
    });
    expect([200, 201]).toContain(blk.status);
    bid = (blk.body.block ?? blk.body).id;
  });

  it("블록 내용 저장", async () => {
    const bp = await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}/blocks/${bid}`, {
      method: "PATCH",
      body: JSON.stringify({ content: { text: "렌터카 반납은 출발 2시간 전" } }),
    });
    expect(bp.status).toBe(200);
  });

  it("정산서 블록은 content 가 비어 있다 (수치를 굳히지 않는다)", async () => {
    const blk = await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}/blocks`, {
      method: "POST",
      body: JSON.stringify({ kind: "settle" }),
    });
    const created = blk.body.block ?? blk.body;
    settleBid = created.id;
    expect(JSON.stringify(created.content)).toBe("{}");
  });

  it("블록 삭제", async () => {
    expect(
      (
        await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}/blocks/${bid}`, { method: "DELETE" })
      ).status,
    ).toBe(200);
    expect(
      (
        await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}/blocks/${settleBid}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);

    const after = (await jh.fetch(`/api/groups/${gid}/docs/${doc.doc.id}`)).body;
    expect(after.blocks.length).toBe(3);
  });
});
