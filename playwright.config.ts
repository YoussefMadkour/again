import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // System Chrome gives us real GPU WebGL; the bundled headless shell is too slow for splats.
    channel: "chrome",
    launchOptions: { args: ["--use-angle=metal"] },
  },
  webServer: {
    // Always our own server, always mock: tests must never spend World Labs credits.
    command: `next dev --turbo --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { AI_MODE: "mock", WORLDLABS_API_KEY: "" },
    timeout: 120_000,
  },
});
