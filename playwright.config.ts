import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  webServer: {
    command:
      "npm run build && ROLE_TOKEN_SECRET=curlcast-playwright-only-secret-32-chars npm start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
