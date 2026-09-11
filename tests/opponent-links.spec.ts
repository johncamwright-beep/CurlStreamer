import { expect, test } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated Supabase fixture.",
);

const linkedOpponentId = "88888888-8888-4888-8888-888888888888";

test.beforeEach(async ({ page }) => {
  await page.goto("/login?next=%2Fdashboard");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
  await page.goto("/games/new");
  await expect(
    page.getByRole("heading", { name: "Schedule a game", exact: true }),
  ).toBeVisible();
});

test("creates a linked opponent and saves its shared YouTube watch link", async ({
  page,
}) => {
  const opponentRequests: Record<string, unknown>[] = [];
  await page.route("**/api/opponent-profiles**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      opponentRequests.push(request.postDataJSON());
      await route.fulfill({
        json: {
          opponent: { id: linkedOpponentId, display_name: "Northern Lights" },
        },
      });
      return;
    }
    if (url.searchParams.has("q")) {
      await route.fulfill({
        json: {
          teams: [
            {
              organization_id: "99999999-9999-4999-8999-999999999999",
              name: "Northern Lights",
              slug: "northern-lights",
              logo_url: null,
              description: "A public CurlStreamer team",
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({ json: { profile: null } });
  });

  await page
    .getByRole("button", { name: "Find a team on CurlStreamer" })
    .click();
  await page.getByLabel("Search public team profiles").fill("Northern");
  await expect(
    page.getByRole("button", { name: "Use opponent: Northern Lights" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use opponent: Northern Lights" })
    .click();
  await expect(
    page.getByLabel("Team 2 — Opponent", { exact: true }),
  ).toHaveValue(linkedOpponentId);
  expect(opponentRequests).toEqual([
    {
      profileId: "99999999-9999-4999-8999-999999999999",
    },
  ]);

  await page.locator('input[name="scheduledDate"]').fill("2026-10-20");
  await page.locator('input[name="scheduledTime"]').fill("18:30");
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  await page
    .getByLabel("Shared YouTube watch link (optional)")
    .fill("https://youtu.be/abcdefghijk");

  const schedules: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    schedules.push(payload);
    await route.fulfill({
      json: { game: { id: payload.gameId }, organizerToken: "fixture-token" },
    });
  });
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Game scheduled", exact: true }),
  ).toBeVisible();
  expect(schedules).toHaveLength(1);
  expect(schedules[0]).toMatchObject({
    opponentId: linkedOpponentId,
    config: {
      youtubeEnabled: false,
      sharedYoutubeWatchUrl: "https://youtu.be/abcdefghijk",
    },
  });
});

test("links a public profile to an existing saved opponent", async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/api/opponent-profiles**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      posts.push(request.postDataJSON());
      await route.fulfill({
        json: {
          opponent: {
            id: "77777777-7777-4777-8777-777777777777",
            display_name: "Team Wright",
          },
        },
      });
      return;
    }
    if (url.searchParams.has("q")) {
      await route.fulfill({
        json: {
          teams: [
            {
              organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              name: "Team Wright",
              slug: "team-wright",
              logo_url: null,
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({ json: { profile: null } });
  });

  const opponent = page.getByLabel("Team 2 — Opponent", { exact: true });
  await opponent.selectOption({ label: "Team Wright" });
  await page
    .getByRole("button", { name: "Find a team on CurlStreamer" })
    .click();
  await page.getByLabel("Search public team profiles").fill("Wright");
  await page.getByRole("button", { name: "Link profile: Team Wright" }).click();
  await expect(opponent).toHaveValue("77777777-7777-4777-8777-777777777777");
  expect(posts).toEqual([
    {
      opponentId: "77777777-7777-4777-8777-777777777777",
      profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  ]);
});
