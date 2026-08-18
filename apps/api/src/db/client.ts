import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { env } from "../env.ts";
import type { Database } from "./types.ts";

/**
 * numeric 을 문자열 그대로 받는다 (기본 동작).
 * 부동소수로 자동 변환되면 원화 금액이 흔들린다 — 읽는 쪽에서 명시적으로 Number() 한다.
 *
 * date(1082) 는 Date 객체 대신 "YYYY-MM-DD" 문자열로 받는다. 타임존 때문에 하루가 밀리는 걸 막는다.
 */
pg.types.setTypeParser(1082, (v: string) => v);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export async function closeDb(): Promise<void> {
  await db.destroy();
}

/** numeric 컬럼 → number. 금액을 읽을 때 반드시 통과시킨다. */
export const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);
