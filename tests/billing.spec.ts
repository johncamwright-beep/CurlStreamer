import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated account fixture",
);

type BillingFixture = {
  available: boolean;
  canManage: boolean;
  hasCustomer: boolean;
  subscription: null | {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
};

async function signIn(page: Page, next = "/account?section=subscription") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === next);
}

async function useBillingFixture(page: Page, fixture: BillingFixture) {
  await page.route("**/api/account/trial", (route) =>
    route.fulfill({ json: { status: "none", expiresAt: null } }),
  );
  await page.route("**/api/account/billing", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(["checkout", "portal"]).toContain(body.action);
      return route.fulfill({
        json: {
          url: `http://localhost:3000/account?section=subscription&billing=${body.action === "checkout" ? "returned" : "cancelled"}`,
        },
      });
    }
    return route.fulfill({
      json: {
        mode: "test",
        ...fixture,
        plan: fixture.available
          ? {
              name: "Pilot plan",
              amount: 2500,
              currency: "CAD",
              interval: "month",
            }
          : null,
      },
    });
  });
}

test("keeps trial redemption available while checkout is being prepared", async ({
  page,
}) => {
  await useBillingFixture(page, {
    available: false,
    canManage: true,
    hasCustomer: false,
    subscription: null,
  });
  await signIn(page);
  await expect(
    page.getByText(
      "Subscription checkout is being prepared. Your trial codes still work.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activate team trial" }),
  ).toBeVisible();
});

test("opens only fixture-backed test checkout and reports a returned state without a success claim", async ({
  page,
}) => {
  await useBillingFixture(page, {
    available: true,
    canManage: true,
    hasCustomer: false,
    subscription: null,
  });
  await signIn(page);
  await expect(
    page.getByText(
      "Stripe test mode — no real payments. Test subscriptions do not change your team’s broadcast access.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Pilot plan: (?:CA)?\$25\.00 \/ month/),
  ).toBeVisible();
  const checkout = page.getByRole("button", { name: "Open test checkout" });
  await expect(checkout).toBeVisible();
  expect((await checkout.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await checkout.click();
  await page.waitForURL("**/account?section=subscription&billing=returned");
  await expect(
    page.getByText(
      /returned from Stripe test checkout.*Reload subscription status/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/payment succeeded/i)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reload subscription status" }),
  ).toBeVisible();
});

test("opens the test portal for an existing test customer", async ({
  page,
}) => {
  await useBillingFixture(page, {
    available: true,
    canManage: true,
    hasCustomer: true,
    subscription: {
      status: "active",
      currentPeriodEnd: "2026-12-31T00:00:00Z",
      cancelAtPeriodEnd: false,
    },
  });
  await signIn(page);
  await expect(
    page.getByText("Test subscription status: active."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open test checkout" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Manage test subscription" }).click();
  await page.waitForURL("**/account?section=subscription&billing=cancelled");
  await expect(page.getByText(/checkout was cancelled/)).toBeVisible();
});

test("does not expose billing controls when the billing service denies management", async ({
  page,
}) => {
  await useBillingFixture(page, {
    available: true,
    canManage: false,
    hasCustomer: false,
    subscription: null,
  });
  await signIn(page);
  await expect(
    page.getByText(
      "Ask a team owner or administrator to manage test subscriptions.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open test checkout" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Manage test subscription" }),
  ).toHaveCount(0);
});
