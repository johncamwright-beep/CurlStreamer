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
  await expect
    .poll(() => new URL(page.url()).searchParams.get("next"))
    .toBe(destination);
  await expect(
    page.getByText("Create your own login using any email", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Sign In" }).click();
  await page.waitForURL((url) => url.pathname === "/login");
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Ask the team owner for a new link",
  );
  await expect(
    page.getByRole("link", { name: "Create account to join" }),
  ).toHaveCount(0);
});

test("signup makes confirmation the next step and preserves the team link", async ({
  page,
}, testInfo) => {
  await page.goto(`/signup?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Display name").fill("Test teammate");
  await page.getByLabel("Email address").fill("unconfirmed@youtube.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("playwright-password");
  await page.getByLabel("Confirm password").fill("playwright-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "One more step: confirm your email" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Resend confirmation email" }).click();
  await expect(
    page.getByText("If this account still needs confirmation", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("confirmation-step.png") });
  await page
    .getByRole("link", { name: "I’ve confirmed my email — sign in" })
    .click();
  await page.waitForURL((url) => url.pathname === "/login");
  expect(new URL(page.url()).searchParams.get("next")).toBe(destination);
});
test("unconfirmed login offers confirmation recovery", async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email address").fill("unconfirmed@youtube.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "One more step: confirm your email" }),
  ).toBeVisible();
  await expect(page.getByText("Invalid email or password.")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Resend confirmation email" }),
  ).toBeVisible();
});
