import { defineConfig } from "@playwright/test";
import { ENVIRONMENT } from "../modules/skill-identity.mjs";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  // 单一共享的 Next dev server 在并行冷编译下会连接重置；串行保证与真实存档的稳定性
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env[ENVIRONMENT.DASHBOARD_URL] || "http://127.0.0.1:4173",
    viewport: { width: 1500, height: 1000 },
    headless: true,
    screenshot: "only-on-failure",
  },
});
