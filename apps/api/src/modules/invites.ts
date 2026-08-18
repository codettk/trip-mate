/**
 * 초대 라우트.
 *
 * 확정된 규칙 (CLAUDE.md):
 *  · 초대 링크는 발급 후 30분만 유효하다. 발급 시각 기준 절대 만료다.
 *  · 사용해도 죽지 않는다 — 여러 명이 같은 링크로 들어온다.
 *  · 새로 발급하면 그 순간 이전 링크는 죽는다.
 *  · 링크로 들어오면 승인 절차 없이 즉시 멤버가 된다.
 */

import { INVITE_TTL_MS, inviteCode, invitePath } from "@tripmate/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOwner } from "../auth/membership.ts";
import { colorFor } from "../auth/routes.ts";
import { requireAuth } from "../auth/session.ts";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { gone, notFound } from "../lib/http.ts";

const gidParam = z.object({ gid: z.string().uuid() });
const codeParam = z.object({ code: z.string().min(8).max(64) });

const inviteUrl = (code: string): string => env.APP_ORIGIN + invitePath(code);

/** 아직 살아 있는 초대. 만료된 것과 취소된 것은 없는 것과 같다. */
async function liveInvite(groupId: string) {
  return db
    .selectFrom("invites")
    .select(["code", "expires_at"])
    .where("group_id", "=", groupId)
    .where("revoked_at", "is", null)
    .where("expires_at", ">", new Date())
    .orderBy("created_at", "desc")
    .executeTakeFirst();
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  // ── 발급 ──────────────────────────────────────────────────────────
  app.post("/api/groups/:gid/invite", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    await requireOwner(user, gid);

    const now = new Date();
    const code = inviteCode();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    // 발급과 동시에 이전 링크를 죽인다. 두 링크가 동시에 살아 있으면
    // "다시 발급했으니 예전 링크는 안 된다"는 약속이 깨진다.
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("invites")
        .set({ revoked_at: now })
        .where("group_id", "=", gid)
        .where("revoked_at", "is", null)
        .execute();
      await trx
        .insertInto("invites")
        .values({ group_id: gid, code, created_by: user.id, expires_at: expiresAt })
        .execute();
    });

    return { code, url: inviteUrl(code), expiresAt };
  });

  // ── 현재 링크 ─────────────────────────────────────────────────────
  app.get("/api/groups/:gid/invite", async (req) => {
    const user = await requireAuth(req);
    const { gid } = gidParam.parse(req.params);
    await requireOwner(user, gid);

    const invite = await liveInvite(gid);
    if (!invite) return null;
    return { code: invite.code, url: inviteUrl(invite.code), expiresAt: invite.expires_at };
  });

  // ── 링크 확인 (로그인 불필요) ─────────────────────────────────────
  // 만료·취소·없음이어도 200 이다. 404 로 내리면 프론트가 "만료됐습니다" 화면을 그릴 수 없다.
  app.get("/api/invites/:code", async (req) => {
    const { code } = codeParam.parse(req.params);

    const row = await db
      .selectFrom("invites")
      .innerJoin("groups", "groups.id", "invites.group_id")
      .select([
        "invites.expires_at as expiresAt",
        "invites.revoked_at as revokedAt",
        "groups.id as id",
        "groups.name as name",
        "groups.dest as dest",
        "groups.start_date as start",
        "groups.end_date as end",
        "groups.deleted_at as deletedAt",
      ])
      .where("invites.code", "=", code)
      .executeTakeFirst();

    if (!row || row.revokedAt || row.deletedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
      return { valid: false };
    }

    const count = await db
      .selectFrom("members")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("group_id", "=", row.id)
      .where("left_at", "is", null)
      .executeTakeFirst();

    return {
      valid: true,
      expiresAt: row.expiresAt,
      group: {
        id: row.id,
        name: row.name,
        dest: row.dest,
        start: row.start,
        end: row.end,
        memberCount: Number(count?.c ?? 0),
      },
    };
  });

  // ── 합류 ──────────────────────────────────────────────────────────
  // 승인 절차가 없다. 링크가 살아 있으면 그 자리에서 멤버가 된다.
  app.post("/api/invites/:code/accept", async (req) => {
    const user = await requireAuth(req);
    const { code } = codeParam.parse(req.params);

    const invite = await db
      .selectFrom("invites")
      .select(["group_id", "expires_at", "revoked_at"])
      .where("code", "=", code)
      .executeTakeFirst();
    if (!invite) throw notFound("초대 링크를 찾을 수 없습니다");
    if (invite.revoked_at || new Date(invite.expires_at).getTime() <= Date.now()) {
      throw gone("만료된 초대 링크입니다");
    }

    const group = await db
      .selectFrom("groups")
      .select(["id", "deleted_at"])
      .where("id", "=", invite.group_id)
      .executeTakeFirst();
    if (!group || group.deleted_at) throw notFound("모임을 찾을 수 없습니다");

    const existing = await db
      .selectFrom("members")
      .select(["id", "left_at"])
      .where("group_id", "=", group.id)
      .where("user_id", "=", user.id)
      .executeTakeFirst();

    if (existing && !existing.left_at) {
      // 이미 멤버면 에러가 아니다 — 링크를 두 번 눌렀을 뿐이다
      return { groupId: group.id, already: true, rejoined: false };
    }

    if (existing) {
      // 나갔던 사람의 복귀. 행을 새로 만들지 않는다 — 정산 이력이 이 멤버 id 에 묶여 있다.
      await db.updateTable("members").set({ left_at: null }).where("id", "=", existing.id).execute();
      return { groupId: group.id, already: false, rejoined: true };
    }

    const color = colorFor(user.id);
    await db
      .insertInto("members")
      .values({
        group_id: group.id,
        user_id: user.id,
        name: user.name, // 합류 시점 이름 스냅샷
        color_bg: color.bg,
        color_fg: color.fg,
        role: "member",
      })
      .execute();

    return { groupId: group.id, already: false, rejoined: false };
  });
}
