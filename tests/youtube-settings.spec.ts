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
  await page.waitForURL("**/account?section=youtube");
  await expect(
    page.getByRole("heading", { name: "YouTube Settings" }),
  ).toBeVisible();
  await expect(
    page.getByText("Connect one YouTube channel for Test Curling Club", {
      exact: false,
    }),
  ).toBeVisible();
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
    page.getByRole("link", { name: "Account & Settings" }),
  ).toBeVisible();
  await page.locator(".app-navigation-close").click();

  await expect(
    page.getByRole("region", { name: "YouTube connection instructions" }),
  ).toContainText("Use another account");
  await page.getByText("Need help connecting?", { exact: true }).click();
  await expect(
    page.getByText("Changing channels:", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Confirm channel disconnection" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep channel", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Confirm channel disconnection" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm disconnect", exact: true })
    .click();
  await expect(page.getByText("YouTube settings updated")).toBeVisible();
});
