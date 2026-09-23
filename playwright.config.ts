import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  // The tests share one server-side store (codes, gallery), so run them in order.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // System Chrome gives us real GPU WebGL; the bundled headless shell is too slow for splats.
    channel: "chrome",
    launchOptions: { args: ["--use-angle=metal"] },
  },
  webServer: {
    // Always our own server, always mock: tests must never spend World Labs credits.
    command: `rm -f .data/e2e-store.json && next dev --turbo --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: {
      AI_MODE: "mock",
      WORLDLABS_API_KEY: "",
      ACCESS_CODES: "trial-once:1,open-sesame:*",
      STORE_FILE: ".data/e2e-store.json",
      NEXT_PUBLIC_CONTACT_URL: "https://x.com/messages/compose",
    },
    timeout: 120_000,
  },
});
