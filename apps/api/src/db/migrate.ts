/**
 * 마이그레이션 러너.
 *
 *   npm run migrate -w @tripmate/api        migrations/*.sql 을 순서대로 적용
 *   npm run reset   -w @tripmate/api        스키마를 통째로 지우고 다시 적용 (개발 전용)
 *
 * 적용된 파일 이름을 _migrations 에 기록하고, 이미 있는 건 건너뛴다.
 * 파일 하나가 트랜잭션 하나다 — 중간에 터지면 그 파일은 통째로 롤백된다.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.ts";
import { pool, closeDb } from "./client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "migrations");

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

function files(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function up(log: (s: string) => void = console.log): Promise<string[]> {
  await ensureTable();
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM _migrations");
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];

  for (const f of files()) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(DIR, f), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [f]);
      await client.query("COMMIT");
      log(`  ✓ ${f}`);
      applied.push(f);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`마이그레이션 실패: ${f}\n${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

export async function reset(log: (s: string) => void = console.log): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("reset 은 운영에서 쓸 수 없습니다.");
  }
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  log("  · public 스키마를 비웠습니다");
  await up(log);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain || process.argv[1]?.endsWith("migrate.ts")) {
  const cmd = process.argv[2] ?? "up";
  const run = cmd === "reset" ? reset : up;
  console.log(`▶ 마이그레이션 ${cmd}`);
  run()
    .then(async () => {
      console.log("완료");
      await closeDb();
    })
    .catch(async (e: Error) => {
      console.error(e.message);
      await closeDb();
      process.exit(1);
    });
}
