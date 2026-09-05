import { defineConfig, devices } from "@playwright/test";

process.env.YOUTUBE_SETTINGS_E2E = "1";
const node = JSON.stringify(process.execPath);

export default defineConfig({
  testDir: "./tests",
  testMatch: ["youtube-settings.spec.ts", "dashboard.spec.ts"],
  fullyParallel: false,
  webServer: [
    {
      command: `${node} tests/support/youtube-supabase-mock.mjs`,
      url: "http://127.0.0.1:3101/auth/v1/user",
      reuseExistingServer: false,
    },
    {
      command: "npm run build && npm start",
      env: {
        ...process.env,
        ROLE_TOKEN_SECRET: "curlcast-playwright-only-secret-32-chars",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3101",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "playwright-public-placeholder",
        SUPABASE_SECRET_KEY: "playwright-server-placeholder",
        GOOGLE_YOUTUBE_CLIENT_ID: "playwright-client",
        GOOGLE_YOUTUBE_CLIENT_SECRET: "playwright-secret",
        GOOGLE_YOUTUBE_REDIRECT_URI:
          "http://localhost:3000/api/settings/youtube/oauth/callback",
        YOUTUBE_CREDENTIAL_ENCRYPTION_KEY:
          "cGxheXdyaWdodC1vbmx5LWNyZWRlbnRpYWwta2V5ISE=",
      },
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
    },
  ],
  use: {
    baseURL: "http://localhost:3000",
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
