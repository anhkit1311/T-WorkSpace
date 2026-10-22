import { defineConfig } from "@playwright/test";

// Runs against the local dev servers (npm run dev) and the local database; uses the installed Chrome.
//   npm run test:e2e
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./global-setup.mjs",
  globalTeardown: "./global-teardown.mjs",
  outputDir: "../test-results/e2e",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5176",
    channel: "chrome",
    locale: "vi-VN",
    trace: "retain-on-failure",
    permissions: ["camera", "microphone"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
});
