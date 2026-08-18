/**
 * 세션. JWT 가 아니라 DB 세션 + httpOnly 쿠키다.
 * 초대·탈퇴·강제 로그아웃을 서버에서 즉시 끊을 수 있어야 하기 때문이다.
 */

import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/client.ts";
import { env, isProd } from "../env.ts";
import { unauthorized } from "../lib/http.ts";

export const SESSION_COOKIE = "tm_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

export interface AuthUser {
  id: string;
  name: string;
  kakaoId: string;
  avatarUrl: string | null;
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insertInto("sessions").values({ id, user_id: userId, expires_at: expiresAt }).execute();
  return { id, expiresAt };
}

export async function destroySession(id: string): Promise<void> {
  await db.deleteFrom("sessions").where("id", "=", id).execute();
}

export async function userForSession(sessionId: string): Promise<AuthUser | null> {
  const row = await db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .select([
      "users.id as id",
      "users.name as name",
      "users.kakao_id as kakaoId",
      "users.avatar_url as avatarUrl",
      "sessions.expires_at as expiresAt",
    ])
    .where("sessions.id", "=", sessionId)
    .executeTakeFirst();

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await destroySession(sessionId);
    return null;
  }
  return { id: row.id, name: row.name, kakaoId: row.kakaoId, avatarUrl: row.avatarUrl };
}

export function setSessionCookie(reply: FastifyReply, id: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    expires: expiresAt,
    signed: false,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** 로그인한 사용자를 붙인다. 없으면 그냥 넘어간다 (공개 라우트용). */
export async function attachUser(req: FastifyRequest): Promise<void> {
  const id = req.cookies[SESSION_COOKIE];
  req.user = id ? await userForSession(id) : null;
  void env;
}

/** 로그인 필수. onRequest 훅으로 건다. */
export async function requireAuth(req: FastifyRequest): Promise<AuthUser> {
  if (!req.user) throw unauthorized();
  return req.user;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}
