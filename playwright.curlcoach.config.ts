import { defineConfig, devices } from "@playwright/test";
process.env.CURLCOACH_E2E = "1";
export default defineConfig({
  testDir: "./tests/curlcoach",
  fullyParallel: false,
  workers: 1,
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3012",
    env: {
      ...process.env,
      CURLCOACH_ENABLED: "true",
      CURLCOACH_LOCAL_LAB: "true",
      CURLCOACH_LAB_SECRET: "curlcoach-e2e-only-key-thirty-two-characters",
      CURLCOACH_LAB_STORAGE: `e2e-${process.pid}`,
    },
    url: "http://127.0.0.1:3012/curlcoach",
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: "http://127.0.0.1:3012",
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    {
      name: "tablet",
      use: { ...devices["iPad Mini"], browserName: "chromium" },
    },
  ],
});
