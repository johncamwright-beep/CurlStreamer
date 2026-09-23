import { test, expect } from "@playwright/test";
test("public pilot homepage explains requirements and handles waitlist success and failure", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bring the rink to everyone." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Log in", exact: true }),
  ).toHaveAttribute("href", "/login");
  await expect(page.getByText("Team Benning", { exact: false })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Travel router", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Social media", exact: true }).click();
  await expect(
    page.getByText("Profile links in pilot · publishing planned"),
  ).toBeVisible();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("pilot-test@example.com");
  await page.getByLabel("Team or club name").fill("Test team");
  await page.getByRole("checkbox").check();
  let attempts = 0;
  await page.route("**/api/pilot-waitlist", async (route) => {
    attempts++;
    expect(route.request().postDataJSON()).toMatchObject({
      email: "pilot-test@example.com",
      consent: true,
    });
    await route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        attempts === 1
          ? { error: "Temporarily unavailable. Try again." }
          : { ok: true },
      ),
    });
  });
  await page
    .getByRole("button", { name: "Join the waitlist", exact: true })
    .click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Temporarily unavailable",
  );
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "pilot-test@example.com",
  );
  await page
    .getByRole("button", { name: "Join the waitlist", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("You’re on the list");
});
