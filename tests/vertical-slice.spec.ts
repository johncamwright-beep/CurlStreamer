import { test, expect } from "@playwright/test";
test("organizer creates a game and sees role links", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByText("Open role chooser")).toBeVisible();
  await expect(page.getByText("Camera — Home End")).toBeVisible();
  await expect(page.getByText("Scorekeeper + Audio")).toBeVisible();
});
test("program canvas stays 16:9 and score/sponsors synchronize", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create game" }).click();
  await page.getByRole("link", { name: "Open scoring" }).click();
  await page.getByRole("button", { name: /Save 1 point/ }).click();
  await expect(page.getByText("MICROPHONES LIVE")).toBeVisible();
  const preview = page.getByRole("link", { name: "Open program preview" });
  const href = await preview.getAttribute("href");
  await page.goto(href!);
  const box = await page.getByTestId("broadcast-canvas").boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  await expect(page.getByText("END 2")).toBeVisible();
});
