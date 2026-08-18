/**
 * ══════════ 공유 묶음 CRUD (멤버 전용) ══════════
 *
 * 폴더마다 켜고 끄던 공개 토글을 대신한다. 한 모임에 용도별로 묶음을 여러 개 두고,
 * 묶음마다 내보낼 폴더를 골라 담는다 ("부모님께" / "동반 모임").
 *
 * ⚠ 밖으로 나가는 것은 담긴 폴더의 **미디어뿐이다.** 문서·정산·일정은 묶음으로도 나가지 않는다.
 * ⚠ 링크는 토큰이 전부다. 묶음 id 에서 파생시키지 않고, 중지하면 그 자리에서 죽는다.
 *
 * 폴더 집합을 세는 계산(`folderCount`)은 core 의 `resolveShared` 다 — 공유 모달이 보여 주는
 * "몇 개 폴더가 나갑니다" 와 서버의 권한 검사가 같은 함수여야 한다.
 */

import { sharePath } from "@tripmate/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember } from "../auth/membership.ts";
import { requireAuth } from "../auth/session.ts";
import { env } from "../env.ts";
import { badRequest } from "../lib/http.ts";
import {
  createShare,
  deleteShare,
  loadShare,
  loadShares,
  photoCountOf,
  rotateShare,
  sharedIdsOf,
  updateShare,
  type ShareLinkFull,
} from "../services/shares.ts";

const gidParams = z.object({ gid: z.string().uuid() });
const gidSidParams = z.object({ gid: z.string().uuid(), sid: z.string().uuid() });

const labelSchema = z.string().trim().max(40, "이름은 40자까지입니다");

/** 빈 배열도 허용한다 — 만들어 두고 폴더는 나중에 담는 흐름이 자연스럽다. */
const entriesSchema = z.array(
  z.object({ folderId: z.string().uuid(), includeDescendants: z.boolean().default(false) }),
);

/** 밖으로 나가는 묶음 모양. 토큰은 url 안에만 있고 폴더 id 외에 다른 식별자를 담지 않는다. */
async function shareView(link: ShareLinkFull) {
  const ids = await sharedIdsOf(link);
  return {
    id: link.id,
    label: link.label,
    url: env.APP_ORIGIN + sharePath(link.group_id, link.token),
    entries: link.entries,
    /** resolveShared 결과 크기 — includeDescendants 로 딸려 나가는 폴더까지 센 실제 개수 */
    folderCount: ids.size,
    photoCount: await photoCountOf(ids),
    createdAt: new Date(link.created_at).toISOString(),
  };
}

export async function shareLinkRoutes(app: FastifyInstance): Promise<void> {
  /** 묶음 목록. 공유 관리 모달이 한 번에 쓰는 응답이다. */
  app.get("/api/groups/:gid/shares", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParams.parse(req.params);
    await requireMember(user, gid);

    const links = await loadShares(gid);
    return { shares: await Promise.all(links.map(shareView)) };
  });

  /** 새 묶음 — 이때 토큰이 발급된다. */
  app.post("/api/groups/:gid/shares", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParams.parse(req.params);
    await requireMember(user, gid);

    const body = z
      .object({ label: labelSchema.default(""), entries: entriesSchema.default([]) })
      .safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");

    const link = await createShare({
      groupId: gid,
      label: body.data.label,
      entries: body.data.entries,
      userId: user.id,
    });
    return { share: await shareView(link) };
  });

  /**
   * 이름·구성 수정.
   * **토큰은 그대로다** — 묶음에서 폴더를 빼면 그 폴더만 즉시 안 보이고 링크 주소는 산다.
   * 뿌린 링크 자체를 끊고 싶으면 rotate 나 삭제를 쓴다.
   */
  app.patch("/api/groups/:gid/shares/:sid", async (req) => {
    const user = await requireAuth(req);
    const { gid, sid } = gidSidParams.parse(req.params);
    await requireMember(user, gid);

    const body = z
      .object({ label: labelSchema.optional(), entries: entriesSchema.optional() })
      .safeParse(req.body ?? {});
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");
    if (body.data.label === undefined && body.data.entries === undefined) {
      throw badRequest("바꿀 값이 없습니다");
    }

    const link = await updateShare(gid, sid, body.data);
    return { share: await shareView(link) };
  });

  /** 중지. 행을 지우므로 뿌린 링크가 그 순간 죽는다. 되살리는 방법은 없다(새 토큰뿐). */
  app.delete("/api/groups/:gid/shares/:sid", async (req) => {
    const user = await requireAuth(req);
    const { gid, sid } = gidSidParams.parse(req.params);
    await requireMember(user, gid);

    await deleteShare(gid, sid);
    return { ok: true };
  });

  /** 토큰 재발급. 담긴 폴더는 그대로 두고 주소만 갈아 끼운다. */
  app.post("/api/groups/:gid/shares/:sid/rotate", async (req) => {
    const user = await requireAuth(req);
    const { gid, sid } = gidSidParams.parse(req.params);
    await requireMember(user, gid);

    await loadShare(gid, sid); // 없는 묶음이면 여기서 404
    const link = await rotateShare(gid, sid);
    return { share: await shareView(link) };
  });
}
