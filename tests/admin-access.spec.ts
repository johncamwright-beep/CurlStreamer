import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated Supabase fixture",
);

const organizationId = "22222222-2222-4222-8222-222222222222";
const invitationId = "44444444-4444-4444-8444-444444444444";

test("pilot administration collects contacts and sends credentials without displaying a password", async ({
  page,
}) => {
  let created = false;
  await page.route("**/api/admin/pilots", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({
        action: "create",
        name: "Pilot Owner",
        phone: "+1 555 123 4567",
        team: "Independent Team",
        coachSeats: 1,
      });
      created = true;
      return route.fulfill({ json: { saved: true, emailStatus: "accepted" } });
    }
    return route.fulfill({
      json: {
        pilots: created
          ? [
              {
                id: invitationId,
                administrator_name: "Pilot Owner",
                email: "owner@example.test",
                phone: "+1 555 123 4567",
                team_name: "Independent Team",
                expires_at: "2027-03-01T00:00:00Z",
                activated_at: null,
                revoked_at: null,
                email_status: "accepted",
                coach_seats: 1,
                members: 1,
                games: 0,
                chartedGames: 0,
              },
            ]
          : [],
      },
    });
  });
  await signIn(page, "/admin");
  await expect(
    page.getByRole("button", { name: "Trial codes", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Administrator name").fill("Pilot Owner");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Phone number").fill("+1 555 123 4567");
  await page.getByLabel("Team name", { exact: true }).fill("Independent Team");
  await page.getByLabel("Pilot access through").fill("2027-03-01");
  await page
    .getByRole("button", { name: "Create pilot and email credentials" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Independent Team" }),
  ).toBeVisible();
  await expect(page.getByText(/Awaiting first password change/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

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

test("waitlist shows signup details and retries pending notifications on desktop and mobile", async ({
  page,
}) => {
  let sent = false;
  await page.route("**/api/admin/waitlist**", async (route) => {
    if (route.request().method() === "POST") {
      sent = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        total: 1,
        recipient: "hello@curlstreamer.app",
        emailConfigured: true,
        entries: [
          {
            id: invitationId,
            email: "waitlist@example.test",
            team: "Fixture team",
            created_at: "2026-11-09T12:00:00Z",
            consent_version: "pilot-2026-09-11",
            notification_status: sent ? "accepted" : "pending",
            notification_sent_at: sent ? "2026-11-09T12:01:00Z" : null,
          },
        ],
      },
    });
  });
  await signIn(page, "/admin/waitlist");
  await expect(
    page.getByRole("heading", { name: "Waitlist (1)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "waitlist@example.test" }),
  ).toBeVisible();
  await expect(page.getByText("Fixture team")).toBeVisible();
  await page.getByRole("button", { name: "Send notification" }).click();
  await expect(page.getByText(/Accepted by email provider/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

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
  await expect(access.getByText("1 of 3 logins in use")).toBeVisible();
  await access.getByLabel("Email address").fill("teammate@example.test");
  await access.getByLabel("Access level").selectOption("game_operator");
  await access.getByRole("button", { name: "Send invitation" }).click();

  await expect(
    access.getByRole("status").filter({
      hasText:
        "Invitation created. Email sending is not connected yet; share the link below.",
    }),
  ).toBeVisible();
  await expect(access.getByLabel("Invitation link")).toHaveValue(
    "http://localhost:3000/join-team?token=invitation-token",
  );
  await expect(
    access.getByText("Pending: teammate@example.test"),
  ).toBeVisible();
  await expect(
    access.getByRole("button", { name: "Send invitation" }),
  ).toBeEnabled();

  await access.getByRole("button", { name: "Revoke invitation" }).click();
  await expect(access.getByText("Invitation revoked.")).toBeVisible();
  await expect(access.getByText("1 of 3 logins in use")).toBeVisible();
  await expect(
    access.getByRole("button", { name: "Send invitation" }),
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
  await page.getByRole("button", { name: "Teams", exact: true }).click();
  await page.getByRole("button", { name: "View as / support" }).click();
  await page.getByRole("button", { name: "Team access", exact: true }).click();

  const access = page.getByRole("region", { name: "Team access" });
  await expect(access.getByText("1 of 3 logins in use")).toBeVisible();
  await expect(access.getByLabel("Email address")).toBeDisabled();
  await expect(
    access.getByRole("button", { name: "Send invitation" }),
  ).toBeDisabled();
  expect(inviteRequests).toBe(0);

  await page.getByRole("button", { name: "Enable support edits" }).click();
  await expect(access.getByLabel("Email address")).toBeEnabled();
  await access.getByLabel("Email address").fill("support@example.test");
  await access.getByLabel("Access level").selectOption("team_admin");
  const create = access.getByRole("button", { name: "Send invitation" });
  await expect(create).toBeEnabled();
  const box = await create.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await create.click();
  await expect(access.getByLabel("Invitation link")).toHaveValue(
    "http://localhost:3000/join-team?token=support-token",
  );
  expect(inviteRequests).toBe(1);
});

test("account logo and privileged menu links persist while navigation refreshes", async ({
  page,
}) => {
  let pause = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const [path, json] of [
    ["appearance", { logo: "/branding/curlstreamer-icon.png" }],
    ["navigation", { platformAdmin: true }],
  ] as const) {
    await page.route("**/api/account/" + path, async (route) => {
      if (pause) await gate;
      await route.fulfill({ json });
    });
  }
  await page.route("**/api/curlcoach/access", async (route) => {
    if (pause) await gate;
    await route.fulfill({ json: { enabled: true } });
  });
  await signIn(page, "/account");
  const logo = page.locator(".account-shortcut img");
  await expect(logo).toHaveAttribute("src", "/branding/curlstreamer-icon.png");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const menu = page.getByRole("navigation", {
    name: "CurlStreamer navigation",
  });
  await expect(menu.getByRole("link", { name: "Shot Tracker" })).toBeVisible();
  await expect(
    menu.getByRole("link", { name: "Platform administration" }),
  ).toBeVisible();
  pause = true;
  try {
    await menu.getByRole("link", { name: "Create game", exact: true }).click();
    await page.waitForURL("**/games/new");
    await expect(logo).toHaveAttribute(
      "src",
      "/branding/curlstreamer-icon.png",
    );
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(
      menu.getByRole("link", { name: "Shot Tracker" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Platform administration" }),
    ).toBeVisible();
  } finally {
    release();
  }
});

test("two pending invitations reserve both additional logins and can be revoked independently", async ({
  page,
}) => {
  const invitations = [
    {
      id: invitationId,
      email: "first@example.test",
      role: "team_admin",
      expiresAt: "2026-12-31T17:00:00Z",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      email: "second@example.test",
      role: "game_operator",
      expiresAt: "2026-12-31T17:00:00Z",
    },
  ];
  await page.route("**/api/account/members", async (route) => {
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
          invitations,
        },
      });
    expect(route.request().postDataJSON()).toEqual({
      action: "revokeInvite",
      invitationId,
    });
    invitations.splice(0, 1);
    return route.fulfill({ json: { saved: true } });
  });
  await signIn(page, "/account?section=members");
  const access = page.getByRole("region", { name: "Team access" });
  await expect(access.getByText("3 of 3 logins in use")).toBeVisible();
  await expect(
    access.getByRole("button", { name: "Send invitation" }),
  ).toBeDisabled();
  await access
    .getByRole("article")
    .filter({ hasText: "first@example.test" })
    .getByRole("button", { name: "Revoke invitation" })
    .click();
  await expect(access.getByText("Pending: first@example.test")).toHaveCount(0);
  await expect(access.getByText("Pending: second@example.test")).toBeVisible();
  await expect(
    access.getByRole("button", { name: "Send invitation" }),
  ).toBeEnabled();
});
