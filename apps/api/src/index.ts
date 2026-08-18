import { buildApp } from "./app.ts";
import { closeDb } from "./db/client.ts";
import { up } from "./db/migrate.ts";
import { env } from "./env.ts";

const app = await buildApp();

// 부팅할 때 마이그레이션을 맞춘다. 도커로 띄울 때 별도 단계를 두지 않기 위해서다.
const applied = await up((s) => app.log.info(s.trim()));
if (applied.length) app.log.info(`마이그레이션 ${applied.length}건 적용`);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void (async () => {
      app.log.info(`${sig} — 종료합니다`);
      await app.close();
      await closeDb();
      process.exit(0);
    })();
  });
}
