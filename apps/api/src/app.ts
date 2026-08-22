import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
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
import { shareLinkRoutes } from "./modules/shares.ts";
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

    // Fastify 가 이미 4xx 로 판정한 것(깨진 JSON, Content-Length 불일치 …)을
    // 500 으로 바꿔 내보내면 안 된다. 보낸 쪽 잘못인데 서버 잘못으로 보이면
    // 원인을 엉뚱한 데서 찾게 된다. 내부 메시지는 담지 않는다.
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      req.log.warn({ err }, "bad request");
      return reply.status(status).send({
        error: { message: "요청이 올바르지 않습니다", code: "bad_request" },
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

  // 웹 번들을 같이 서빙할지. 무료 호스팅은 안 쓰면 잠들기 때문에, 웹과 API 를
  // 따로 두면 웹만 깨어나고 API 는 자고 있어 첫 요청이 엇갈린다. 하나로 합치면
  // 깨는 것도 한 번이고 주소도 하나다. 비워 두면 예전처럼 API 만 돈다.
  const webDist = env.WEB_DIST ? resolve(process.cwd(), env.WEB_DIST) : null;
  const serveWeb = webDist !== null && existsSync(join(webDist, "index.html"));

  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      // 해시가 붙은 자산만 오래 캐시한다. index.html 은 절대 캐시하면 안 된다 —
      // 새로 배포해도 옛 번들을 계속 보게 된다.
      setHeaders(reply, filePath) {
        const cacheForever = filePath.includes(`${sep}assets${sep}`);
        reply.header("Cache-Control", cacheForever ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    // API 경로는 언제나 JSON 404 다. SPA 를 돌려주면 없는 엔드포인트를 부른 쪽이
    // HTML 을 받고 파싱에서 터져 원인을 엉뚱한 데서 찾게 된다.
    if (!serveWeb || req.url.startsWith("/api/")) {
      return reply.status(404).send({ error: { message: "없는 경로입니다", code: "not_found" } });
    }
    // 나머지는 SPA — 뷰어 주소(/{groupId}/view/{token})가 직접 열려야 한다.
    return reply.sendFile("index.html");
  });

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
  await app.register(shareLinkRoutes);
  await app.register(shareRoutes);

  return app;
}
