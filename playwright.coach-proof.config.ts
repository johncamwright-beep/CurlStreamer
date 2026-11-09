import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["coach-local-proof.spec.ts", "coach-handoff.spec.ts"],
  workers: 1,
  use: { channel: process.platform === "win32" ? "msedge" : undefined },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
