import { test, expect } from "@playwright/test";
test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Isolated account fixture required",
);
const destination = `/join-team?token=${"a".repeat(43)}`;
test("invitation guides a new account without offering acceptance before sign-in", async ({
  page,
}) => {
  await page.goto(destination);
  await expect(
    page.getByRole("heading", { name: "Join Test Curling Club" }),
  ).toBeVisible();
  await expect(
    page.getByText("any email address you prefer", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Join team", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Create account to join" }).click();
  expect(new URL(page.url()).searchParams.get("next")).toBe(destination);
  await expect(
    page.getByText("Create your own login using any email", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Sign In" }).click();
  expect(new URL(page.url()).searchParams.get("next")).toBe(destination);
});
test("signed-in recipient explicitly joins and sees the team dashboard button", async ({
  page,
}) => {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("You’ll join as", { exact: false }),
  ).toBeVisible();
  await page.route("**/api/account/members/accept", (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.getByRole("button", { name: "Join team", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Test Curling Club" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open team dashboard" }),
  ).toHaveAttribute("href", "/dashboard");
  await expect(
    page.getByRole("button", { name: "Join team", exact: true }),
  ).toHaveCount(0);
});
test("invalid links explain how to recover without creating an account", async ({
  page,
}) => {
  await page.goto("/join-team?token=invalid");
  await expect(page.getByRole("alert")).toContainText(
    "Ask the team owner for a new link",
  );
  await expect(
    page.getByRole("link", { name: "Create account to join" }),
  ).toHaveCount(0);
});
