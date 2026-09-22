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
      json: { game: { id: payload.gameId } },
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

test("opponent roster and level remain independent across seasons", async ({
  page,
}) => {
  const first = "11111111-1111-4111-8111-111111111111",
    second = "22222222-2222-4222-8222-222222222222";
  const profiles: Record<string, unknown>[] = [];
  await page.route("**/api/opponent-seasons", async (route) => {
    if (route.request().method() === "POST") {
      const b = route.request().postDataJSON();
      const profile = {
        opponent_id: b.opponentId,
        season_id: b.seasonId,
        level: b.level,
        roster: b.roster,
        revision: 1,
      };
      profiles.push(profile);
      await route.fulfill({ json: { profile } });
    } else
      await route.fulfill({
        json: {
          profiles,
          seasons: [
            { id: first, name: "2026-27", status: "active" },
            { id: second, name: "2027-28", status: "planned" },
          ],
        },
      });
  });
  await page.goto("/opponents");
  await page
    .getByRole("button", { name: "Season details", exact: true })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Competition level", exact: true })
    .selectOption("U20");
  await page.getByLabel("Lead", { exact: true }).fill("Alex Firstseason");
  await page.getByRole("button", { name: "Save season details" }).click();
  await expect(page.getByRole("status")).toContainText("2026-27 saved");
  await page
    .getByRole("combobox", { name: "Opponent season", exact: true })
    .selectOption(second);
  await page
    .getByRole("button", { name: "Season details", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Lead", { exact: true })).toHaveValue("");
  await page.getByLabel("Lead", { exact: true }).fill("Jordan Nextseason");
  await page
    .getByRole("combobox", { name: "Competition level", exact: true })
    .selectOption("Men’s");
  await page.getByRole("button", { name: "Save season details" }).click();
  await expect(page.getByRole("status")).toContainText("2027-28 saved");
  await page
    .getByRole("combobox", { name: "Opponent season", exact: true })
    .selectOption(first);
  await page
    .getByRole("button", { name: "Season details", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Lead", { exact: true })).toHaveValue(
    "Alex Firstseason",
  );
  await expect(
    page.getByRole("combobox", { name: "Competition level", exact: true }),
  ).toHaveValue("U20");
  expect(profiles).toHaveLength(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
