import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3100",
    headless: true,
    channel: "chrome",
    screenshot: "only-on-failure",
  },
});
