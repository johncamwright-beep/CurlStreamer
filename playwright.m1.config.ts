import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "m1-direct-spike.spec.ts",
  fullyParallel: false,
  workers: 1,
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3107",
    url: "http://127.0.0.1:3107",
    reuseExistingServer: false,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        "m1-browser-test-public-placeholder",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "off",
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  },
  projects: [
    { name: "m1-desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "m1-mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
