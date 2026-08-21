/**
 * 로그인 — 카카오 하나만 지원한다. 이메일·비밀번호도, 구글 로그인도 만들지 않는다.
 *
 * AUTH_MODE=mock  개발 전용. 이름만 넣으면 그 이름의 사용자로 로그인한다.
 *                 카카오 앱 키 없이 전체 기능을 테스트할 수 있어야 하기 때문이다.
 * AUTH_MODE=kakao 실제 OAuth. /api/auth/kakao → 카카오 → /api/auth/kakao/callback
 */

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.ts";
import { env, isProd } from "../env.ts";
import { badRequest, unauthorized } from "../lib/http.ts";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie,
  SESSION_COOKIE,
} from "./session.ts";

const AVATAR_COLORS = [
  { bg: "#E3EAFB", fg: "#2F53E0" },
  { bg: "#FBE4E8", fg: "#D8455C" },
  { bg: "#F1E8FB", fg: "#7A4FD0" },
  { bg: "#DEF1EA", fg: "#12866A" },
  { bg: "#FFF0E7", fg: "#DD6428" },
  { bg: "#E9F0FF", fg: "#2F6BD8" },
];

/** 사용자 id 로 항상 같은 색을 뽑는다 — 화면마다 색이 바뀌면 안 된다. */
export function colorFor(seed: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/**
 * 카카오는 프로필 사진을 `http://` 로 준다. 그대로 두면 HTTPS 로 서비스할 때
 * 브라우저가 혼합 콘텐츠로 막아 사진이 통째로 안 나온다. 저장할 때 한 번만 올려 둔다.
 * (k.kakaocdn.net 은 https 로도 같은 이미지를 준다 — 확인함)
 */
function httpsOnly(url: string | null): string | null {
  return url && url.startsWith("http://") ? "https://" + url.slice("http://".length) : url;
}

async function upsertUser(kakaoId: string, name: string, rawAvatarUrl: string | null) {
  const avatarUrl = httpsOnly(rawAvatarUrl);
  const existing = await db
    .selectFrom("users")
    .selectAll()
    .where("kakao_id", "=", kakaoId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable("users")
      .set({ name, avatar_url: avatarUrl, updated_at: new Date() })
      .where("id", "=", existing.id)
      .execute();
    return { ...existing, name, avatar_url: avatarUrl };
  }

  return db
    .insertInto("users")
    .values({ kakao_id: kakaoId, name, avatar_url: avatarUrl })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** OAuth state 를 잠깐 들고 있는다. 단일 인스턴스 전제 — 다중화하면 Redis 로 옮긴다. */
const pendingStates = new Map<string, number>();
const STATE_TTL = 10 * 60 * 1000;

function newState(): string {
  const s = randomBytes(16).toString("base64url");
  pendingStates.set(s, Date.now() + STATE_TTL);
  for (const [k, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(k);
  return s;
}

function useState(s: string): boolean {
  const exp = pendingStates.get(s);
  if (!exp || exp < Date.now()) return false;
  pendingStates.delete(s);
  return true;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/me", async (req) => {
    if (!req.user) return { user: null, authMode: env.AUTH_MODE };
    return { user: req.user, authMode: env.AUTH_MODE };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) await destroySession(sid);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // ── 개발용 목 로그인 ──────────────────────────────────────────────
  app.post("/api/auth/mock", async (req, reply) => {
    if (env.AUTH_MODE !== "mock" || isProd) {
      throw unauthorized("목 로그인이 꺼져 있습니다");
    }
    const body = z
      .object({ name: z.string().trim().min(1).max(20), kakaoId: z.string().trim().optional() })
      .safeParse(req.body);
    if (!body.success) throw badRequest("이름을 입력하세요");

    const kakaoId = body.data.kakaoId?.trim() || `mock:${body.data.name}`;
    const user = await upsertUser(kakaoId, body.data.name, null);
    const s = await createSession(user.id);
    setSessionCookie(reply, s.id, s.expiresAt);
    return {
      user: { id: user.id, name: user.name, kakaoId: user.kakao_id, avatarUrl: user.avatar_url },
    };
  });

  // ── 카카오 OAuth ──────────────────────────────────────────────────
  app.get("/api/auth/kakao", async (req, reply) => {
    if (env.AUTH_MODE !== "kakao") throw badRequest("AUTH_MODE 가 kakao 가 아닙니다");
    const next = typeof (req.query as any)?.next === "string" ? (req.query as any).next : "/";
    const state = newState() + "|" + Buffer.from(next).toString("base64url");
    const url = new URL("https://kauth.kakao.com/oauth/authorize");
    url.searchParams.set("client_id", env.KAKAO_REST_API_KEY);
    url.searchParams.set("redirect_uri", env.KAKAO_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get("/api/auth/kakao/callback", async (req, reply) => {
    if (env.AUTH_MODE !== "kakao") throw badRequest("AUTH_MODE 가 kakao 가 아닙니다");
    const q = z
      .object({ code: z.string().min(1), state: z.string().min(1) })
      .safeParse(req.query);
    if (!q.success) throw badRequest("카카오 응답이 올바르지 않습니다");

    const [rawState, encodedNext] = q.data.state.split("|");
    if (!rawState || !useState(rawState)) throw badRequest("만료되었거나 잘못된 요청입니다");
    const next = encodedNext ? Buffer.from(encodedNext, "base64url").toString("utf8") : "/";

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.KAKAO_REST_API_KEY,
      redirect_uri: env.KAKAO_REDIRECT_URI,
      code: q.data.code,
    });
    if (env.KAKAO_CLIENT_SECRET) form.set("client_secret", env.KAKAO_CLIENT_SECRET);

    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: form,
    });
    if (!tokenRes.ok) throw unauthorized("카카오 토큰 발급에 실패했습니다");
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw unauthorized("카카오 토큰이 비어 있습니다");

    const meRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!meRes.ok) throw unauthorized("카카오 사용자 정보를 가져오지 못했습니다");
    const me = (await meRes.json()) as {
      id: number;
      kakao_account?: { profile?: { nickname?: string; profile_image_url?: string } };
    };

    const profile = me.kakao_account?.profile;
    const user = await upsertUser(
      String(me.id),
      profile?.nickname?.trim() || "이름없음",
      profile?.profile_image_url ?? null,
    );
    const s = await createSession(user.id);
    setSessionCookie(reply, s.id, s.expiresAt);

    // 초대 URL 로 들어온 경우 그 경로로 돌려보낸다 → "○○ 모임에 참여하시겠습니까?"
    const safeNext = next.startsWith("/") ? next : "/";
    return reply.redirect(env.APP_ORIGIN + safeNext);
  });
}
