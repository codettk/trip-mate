import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
// vitest 설정(test 키)을 같은 파일에 두려면 vitest 쪽 defineConfig 를 써야 한다.
// vite 의 defineConfig 는 test 키를 모른다.
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const core = fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": src,
      // dist 가 아니라 소스를 직접 본다 — core 를 고치면 HMR 이 바로 따라온다
      "@tripmate/core": core,
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 개발 중에는 같은 오리진처럼 보이게 해서 쿠키가 그대로 붙는다
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    // jsdom 보강 + console.error/alert 감시. 렌더 테스트가 조용히 통과하지 않게 한다.
    setupFiles: ["./src/test/setup.ts"],
  },
});
