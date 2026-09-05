import { expect, test } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Runs with the isolated authenticated Supabase mock config",
);

test("team administrator can inspect and disconnect the saved YouTube channel", async ({
  page,
}) => {
  await page.goto("/login?next=/settings/youtube");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/settings/youtube");
  await expect(
    page.getByRole("heading", { name: "YouTube Settings" }),
  ).toBeVisible();
  await expect(page.getByText("Test Curling Club")).toBeVisible();
  await expect(page.getByText("Test Club TV")).toBeVisible();
  await expect(page.getByText("UC_TEST_CHANNEL")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test connection" }),
  ).toBeVisible();
  await expect(page.getByText(/No live broadcast is started/i)).toBeVisible();

  for (const control of [
    page.getByRole("button", { name: "Test connection" }),
    page.getByRole("link", { name: "Reconnect" }),
    page.getByRole("button", { name: "Disconnect" }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(
    page.getByRole("link", { name: "YouTube Settings" }),
  ).toBeVisible();
  await page.locator(".app-navigation-close").click();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("YouTube settings updated")).toBeVisible();
});
