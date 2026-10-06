import { expect, test } from "@playwright/test";

test("public policies are reachable without signing in and linked from the homepage", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole("heading", { name: "Privacy Policy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Google Account permissions", exact: true }),
  ).toHaveAttribute("href", "https://myaccount.google.com/permissions");
  await expect(
    page.getByText("CurlStreamer is operated by John Wright.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Terms of Service", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Terms of Service", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "YouTube Terms of Service", exact: true }),
  ).toHaveAttribute("href", "https://www.youtube.com/t/terms");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
