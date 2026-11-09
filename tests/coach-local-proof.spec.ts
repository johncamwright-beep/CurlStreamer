import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startCoachLocalProof } from "../src/lib/providers/coach-local-proof";
for (const rolling of [false, true])
  test(`local ${rolling ? "rolling" : "fixed"} video selection preserves independent audience and notes`, async ({
    page,
  }) => {
    const proof = await startCoachLocalProof({
      host: "127.0.0.1",
      port: 0,
      video: resolve("public/celebrations/cat-dance.mp4"),
      ...(rolling
        ? {
            capture: async () => ({
              video: resolve("public/celebrations/cat-dance.mp4"),
              duration: 5,
              capturedAt: new Date().toISOString(),
            }),
          }
        : {}),
      code: "123456",
      duration: 120,
    });
    try {
      await page.goto(proof.address);
      await page.getByLabel("Pairing code from your laptop").fill("123456");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Use this start" }),
      ).toBeEnabled();
      await expect(page.locator("video")).toHaveJSProperty("controls", false);
      await page
        .getByRole("slider", { name: "Drag to the beginning of the shot" })
        .fill("2");
      await page
        .getByRole("button", { name: "+1 second", exact: true })
        .click();
      await expect(page.locator("video")).toHaveJSProperty("currentTime", 3);
      await page
        .getByRole("button", { name: "−1 second", exact: true })
        .click();
      await expect(page.locator("video")).toHaveJSProperty("currentTime", 2);
      await page.getByRole("radio", { name: "Team", exact: true }).check();
      await page.getByText("Add notes", { exact: true }).click();
      await page
        .getByLabel("Notes", { exact: true })
        .fill("Watch this together");
      await page.getByRole("button", { name: "Use this start" }).click();
      await expect(
        page.getByText(/Selected 0:02.0 for team review/),
      ).toBeVisible();
      expect(proof.stats().selection).toEqual({
        startSeconds: 2,
        audience: "team",
        notes: "Watch this together",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      proof.close();
    }
  });
