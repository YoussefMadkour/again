import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    // System Chrome gives us real GPU WebGL; the bundled headless shell is too slow for splats.
    channel: "chrome",
    launchOptions: { args: ["--use-angle=metal"] },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
