import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  webServer: {
    command: "npm run build && npm start",
    env: {
      ...process.env,
      ROLE_TOKEN_SECRET: "curlcast-playwright-only-secret-32-chars",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "playwright-public-placeholder",
      SUPABASE_SECRET_KEY: "playwright-server-placeholder",
    },
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
