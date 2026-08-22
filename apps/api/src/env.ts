/**
 * 환경변수. 부팅 시 한 번 읽고 검증한다.
 * 잘못된 설정으로 조용히 뜨느니 부팅에서 터지는 게 낫다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/** .env 를 직접 읽는다 (dotenv 의존성을 더하지 않는다). 이미 있는 process.env 를 덮지 않는다. */
function loadDotEnv(): void {
  for (const dir of [process.cwd(), resolve(process.cwd(), "../.."), resolve(process.cwd(), "..")]) {
    try {
      const raw = readFileSync(resolve(dir, ".env"), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1]!;
        let val = m[2]!.trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
      return;
    } catch {
      // 없으면 다음 후보로
    }
  }
}

loadDotEnv();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET 은 32자 이상이어야 합니다"),
  DATABASE_URL: z.string().min(1),

  AUTH_MODE: z.enum(["mock", "kakao"]).default("mock"),
  KAKAO_REST_API_KEY: z.string().default(""),
  KAKAO_CLIENT_SECRET: z.string().default(""),
  KAKAO_REDIRECT_URI: z.string().default("http://localhost:4000/api/auth/kakao/callback"),

  STORAGE_DRIVER: z.enum(["local", "gdrive"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REFRESH_TOKEN: z.string().default(""),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().default(""),

  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(200),

  // 웹 번들이 있는 디렉터리. 채우면 API 가 정적 파일까지 직접 서빙한다 —
  // 서비스 하나로 배포할 때 쓴다. 비우면 API 만 돌고 웹은 따로 띄운다(개발 기본값).
  WEB_DIST: z.string().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  · ${i.path.join(".")}: ${i.message}`);
  throw new Error(`환경변수 설정이 잘못됐습니다.\n${lines.join("\n")}\n\n.env.example 을 참고하세요.`);
}

export const env = parsed.data;

/** 목 로그인은 개발 전용이다. 운영에서 켜져 있으면 부팅을 거부한다. */
if (env.NODE_ENV === "production" && env.AUTH_MODE === "mock") {
  throw new Error("AUTH_MODE=mock 은 개발 전용입니다. 운영에서는 kakao 로 설정하세요.");
}

if (env.AUTH_MODE === "kakao" && !env.KAKAO_REST_API_KEY) {
  throw new Error("AUTH_MODE=kakao 인데 KAKAO_REST_API_KEY 가 비어 있습니다.");
}

if (env.STORAGE_DRIVER === "gdrive") {
  const missing = (
    [
      ["GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID],
      ["GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET],
      ["GOOGLE_REFRESH_TOKEN", env.GOOGLE_REFRESH_TOKEN],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `STORAGE_DRIVER=gdrive 인데 ${missing.join(", ")} 가 비어 있습니다.\n` +
        "OAuth 클라이언트 시크릿 + 리프레시 토큰이 필요합니다 (서비스 계정 키도, API 키도 아닙니다).",
    );
  }
}

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const MAX_UPLOAD_BYTES = env.MAX_UPLOAD_MB * 1024 * 1024;
