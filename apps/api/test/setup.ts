/**
 * 통합 테스트 준비 (vitest globalSetup).
 *
 * ⚠ 순서가 중요하다. src/env.ts 는 모듈 최상단에서 환경변수를 검증하므로
 *   process.env 를 먼저 채운 다음에야 DB·앱 모듈을 import 할 수 있다.
 *   그래서 이 파일은 정적 import 를 쓰지 않고 동적 import 만 쓴다.
 *
 * 실제 Postgres 에 붙는다. 목 DB 를 쓰지 않는다 — 정산은 numeric·정수 규칙이 걸려 있어서
 * 진짜 DB 가 아니면 검증이 의미를 잃는다.
 */

/** 워커 프로세스에도 그대로 넘긴다 (vitest.config.ts 의 test.env). */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? "postgresql://tripmate:tripmate@localhost:5434/tripmate_test",
  AUTH_MODE: "mock",
  STORAGE_DRIVER: "local",
  LOCAL_STORAGE_DIR: ".data/test-storage",
  SESSION_SECRET: "tripmate-integration-test-session-secret-0123456789",
  APP_ORIGIN: "http://localhost:5173",
  // 카카오·Drive 키는 쓰지 않는다. 목 로그인 + 로컬 저장소로 전 구간을 돈다.
  KAKAO_REST_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_REFRESH_TOKEN: "",
};

const HELP = [
  "",
  "══════════════════════════════════════════════════════════════",
  " 테스트 DB 에 접속할 수 없습니다.",
  "",
  `   DATABASE_URL: ${TEST_ENV.DATABASE_URL}`,
  "",
  " 통합 테스트는 실제 Postgres 에 붙습니다. 아래 명령으로 테스트 DB 를 띄우세요:",
  "",
  "   docker compose --profile test up -d db-test",
  "",
  " (개발 DB(5433)는 건드리지 않습니다. 테스트 DB 는 5434 포트의 별도 컨테이너입니다.)",
  "══════════════════════════════════════════════════════════════",
  "",
].join("\n");

export default async function setup(): Promise<void> {
  Object.assign(process.env, TEST_ENV);

  // ⚠ 여기서는 kysely 를 쓰지 않고 pool 로만 질의한다.
  //   kysely 는 첫 연결 때 풀을 붙잡으므로, 쓰지 않은 상태에서 destroy() 해도 풀이 안 닫힌다.
  //   그래서 정리는 pool.end() 로 직접 한다 — 안 그러면 vitest 가 종료되지 못하고 매달린다.
  const { pool } = await import("../src/db/client.ts");

  // 컨테이너가 막 떴을 수 있으니 잠깐 기다려 준다. 그래도 안 되면 안내하고 멈춘다.
  let lastErr: unknown = null;
  for (let i = 0; i < 10; i++) {
    try {
      await pool.query("select 1");
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (lastErr) {
    console.error(HELP);
    await pool.end().catch(() => undefined);
    throw new Error(`테스트 DB 접속 실패: ${(lastErr as Error).message}`);
  }

  // 스키마는 매 실행마다 새로 만든다. 지난 실행의 잔재가 남으면 검사가 흔들린다.
  const { reset } = await import("../src/db/migrate.ts");
  await reset(() => undefined);

  await pool.end();
}
