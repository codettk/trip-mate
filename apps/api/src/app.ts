import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { authRoutes } from "./auth/routes.ts";
import { attachUser } from "./auth/session.ts";
import { env, isProd, MAX_UPLOAD_BYTES } from "./env.ts";
import { ApiError } from "./lib/http.ts";
import { docRoutes } from "./modules/docs.ts";
import { folderRoutes } from "./modules/folders.ts";
import { groupRoutes } from "./modules/groups.ts";
import { inviteRoutes } from "./modules/invites.ts";
import { itineraryRoutes } from "./modules/itinerary.ts";
import { photoRoutes } from "./modules/photos.ts";
import { settlementRoutes } from "./modules/settlement.ts";
import { shareRoutes } from "./modules/share.ts";
import { storage } from "./storage/index.ts";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProd
      ? { level: "info" }
      : { level: "info", transport: undefined },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: [env.APP_ORIGIN],
    credentials: true,
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 20 },
  });

  // 모든 요청에 로그인 정보를 붙인다. 필수 여부는 각 라우트가 정한다.
  app.addHook("onRequest", attachUser);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({
        error: { message: err.message, code: err.code, detail: err.detail },
      });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          message: "입력값이 올바르지 않습니다",
          code: "bad_request",
          detail: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }
    if ((err as { statusCode?: number }).statusCode === 413) {
      return reply.status(413).send({
        error: { message: "파일이 너무 큽니다", code: "too_large" },
      });
    }
    req.log.error({ err }, "unhandled");
    return reply.status(500).send({
      error: {
        // 운영에서는 내부 메시지를 밖으로 내보내지 않는다 — 스택이나 SQL 이 새면 안 된다
        message: isProd
          ? "서버 오류가 발생했습니다"
          : err instanceof Error
            ? err.message
            : String(err),
        code: "internal",
      },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { message: "없는 경로입니다", code: "not_found" } }),
  );

  app.get("/api/health", async () => {
    const s = await storage();
    return {
      ok: true,
      authMode: env.AUTH_MODE,
      storage: { driver: s.kind, healthy: await s.healthy() },
    };
  });

  await app.register(authRoutes);
  await app.register(groupRoutes);
  await app.register(inviteRoutes);
  await app.register(itineraryRoutes);
  await app.register(settlementRoutes);
  await app.register(folderRoutes);
  await app.register(photoRoutes);
  await app.register(docRoutes);
  await app.register(shareRoutes);

  return app;
}
