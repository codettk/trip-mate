import { defineConfig } from "vitest/config";
import { TEST_ENV } from "./test/setup.ts";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/setup.ts"],
    // env.ts 는 모듈 최상단에서 검증한다. 워커에서도 import 보다 먼저 채워져야 한다.
    env: TEST_ENV,
    // 파일마다 wipe+seed 로 같은 출발점을 만든다 → DB 를 공유하므로 동시에 돌리면 안 된다.
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
