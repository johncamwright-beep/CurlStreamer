import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated Supabase fixture",
);

const organizationId = "22222222-2222-4222-8222-222222222222";
const invitationId = "44444444-4444-4444-8444-444444444444";

test("main menu shows platform administration above sign out only while authorized", async ({
  page,
}) => {
  let allowed = true;
  await page.route("**/api/account/navigation", (route) =>
    route.fulfill({ json: { platformAdmin: allowed } }),
  );
  await signIn(page, "/account");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const menu = page.getByRole("navigation", {
    name: "CurlStreamer navigation",
  });
  const link = menu.getByRole("link", { name: "Platform administration" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/admin");
  const adminBox = await link.boundingBox();
  const signOutBox = await menu
    .getByRole("button", { name: "Sign out" })
    .boundingBox();
  expect(adminBox!.height).toBeGreaterThanOrEqual(44);
  expect(adminBox!.y + adminBox!.height).toBeLessThanOrEqual(signOutBox!.y + 1);
  await menu.getByRole("button", { name: "Close navigation menu" }).click();
  allowed = false;
  const checked = page.waitForResponse("**/api/account/navigation");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await checked;
  await expect(link).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
});

async function signIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === next);
}

test("team owners can create, share, and revoke a teammate invitation", async ({
  page,
}) => {
  let invitation = false;
  await page.route("**/api/account/members", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          canManage: true,
          members: [
            {
              id: organizationId,
              email: "admin@youtube.test",
              role: "owner",
              status: "active",
            },
          ],
          invitation: invitation
            ? {
                id: invitationId,
                email: "teammate@example.test",
                role: "game_operator",
                expiresAt: "2026-12-31T17:00:00Z",
              }
            : null,
        },
      });
    }

    const body = route.request().postDataJSON();
    if (body.action === "invite") {
      expect(body).toEqual({
        action: "invite",
        email: "teammate@example.test",
        role: "game_operator",
      });
      invitation = true;
      return route.fulfill({
        json: {
          inviteUrl: "http://localhost:3000/join-team?token=invitation-token",
          emailSent: false,
        },
      });
    }
    expect(body).toEqual({ action: "revokeInvite", invitationId });
    invitation = false;
    return route.fulfill({ json: { saved: true } });
  });

  await signIn(page, "/account?section=members");
  const access = page.getByRole("region", { name: "Team access" });
  await expect(access.getByText("1 of 2 logins in use")).toBeVisible();
  await access.getByLabel("Email address").fill("teammate@example.test");
  await access.getByLabel("Access level").selectOption("game_operator");
  await access.getByRole("button", { name: "Create invitation" }).click();

  await expect(
    access.getByRole("status").filter({
      hasText: "Invitation created. Share the link below with your teammate.",
    }),
  ).toBeVisible();
  await expect(access.getByLabel("Invitation link")).toHaveValue(
    "http://localhost:3000/join-team?token=invitation-token",
  );
  await expect(
    access.getByText("Pending: teammate@example.test"),
  ).toBeVisible();
  await expect(
    access.getByRole("button", { name: "Create invitation" }),
  ).toBeDisabled();

  await access.getByRole("button", { name: "Revoke invitation" }).click();
  await expect(access.getByText("Invitation revoked.")).toBeVisible();
  await expect(access.getByText("1 of 2 logins in use")).toBeVisible();
  await expect(
    access.getByRole("button", { name: "Create invitation" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("platform administrators keep team access read-only until support edits are enabled", async ({
  page,
}) => {
  let inviteRequests = 0;
  await page.route("**/api/admin", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          teams: [
            {
              id: organizationId,
              name: "Test Curling Club",
              trialExpiresAt: null,
              members: [
                {
                  id: organizationId,
                  userId: organizationId,
                  email: "admin@youtube.test",
                  role: "owner",
                  status: "active",
                },
              ],
            },
          ],
          accounts: [],
          codes: [],
        },
      });
    return route.fulfill({ json: { saved: true } });
  });
  await page.route(
    `**/api/admin/teams/${organizationId}/members`,
    async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: {
            canManage: true,
            members: [
              {
                id: organizationId,
                email: "admin@youtube.test",
                role: "owner",
                status: "active",
              },
            ],
            invitation: null,
          },
        });

      inviteRequests++;
      expect(route.request().postDataJSON()).toEqual({
        action: "invite",
        email: "support@example.test",
        role: "team_admin",
      });
      return route.fulfill({
        json: {
          inviteUrl: "http://localhost:3000/join-team?token=support-token",
          emailSent: false,
        },
      });
    },
  );

  await signIn(page, "/admin");
  await expect(
    page.getByRole("heading", { name: "Platform administration" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View as / support" }).click();
  await page.getByRole("button", { name: "Team access", exact: true }).click();

  const access = page.getByRole("region", { name: "Team access" });
  await expect(access.getByText("1 of 2 logins in use")).toBeVisible();
  await expect(access.getByLabel("Email address")).toBeDisabled();
  await expect(
    access.getByRole("button", { name: "Create invitation" }),
  ).toBeDisabled();
  expect(inviteRequests).toBe(0);

  await page.getByRole("button", { name: "Enable support edits" }).click();
  await expect(access.getByLabel("Email address")).toBeEnabled();
  await access.getByLabel("Email address").fill("support@example.test");
  await access.getByLabel("Access level").selectOption("team_admin");
  const create = access.getByRole("button", { name: "Create invitation" });
  await expect(create).toBeEnabled();
  const box = await create.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await create.click();
  await expect(access.getByLabel("Invitation link")).toHaveValue(
    "http://localhost:3000/join-team?token=support-token",
  );
  expect(inviteRequests).toBe(1);
});
