import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated Supabase fixture.",
);

const opponentId = "77777777-7777-4777-8777-777777777777";
const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const emptyRoster = {
  lead: "",
  second: "",
  third: "",
  fourth: "",
  alternate: "",
  coach: "",
};
type Profile = {
  opponent_id: string;
  season_id: string;
  level: string | null;
  roster: typeof emptyRoster;
  revision: number;
};

async function directory(
  page: Page,
  profiles: Map<string, Profile> = new Map(),
  seasons = [
    { id: first, name: "2026-27", status: "active" },
    { id: second, name: "2027-28", status: "planned" },
  ],
) {
  await page.route("**/api/opponent-seasons", (route) =>
    route.fulfill({
      json: {
        profiles: [...profiles.values()],
        seasons,
      },
    }),
  );
  await page.goto("/opponents");
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/login?next=%2Fdashboard");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
});

test("archived season history remains visible while opponent editing is disabled", async ({
  page,
}) => {
  const profiles = new Map<string, Profile>([
    [
      first,
      {
        opponent_id: opponentId,
        season_id: first,
        level: "U20",
        roster: { ...emptyRoster, lead: "Archived lead" },
        revision: 2,
      },
    ],
  ]);
  await directory(page, profiles, [
    { id: first, name: "2026-27", status: "archived" },
    { id: second, name: "2027-28", status: "planned" },
  ]);
  await expect(page.getByLabel("Opponent season")).toHaveValue(first);
  await expect(
    page.getByText("U20 · Archived lead", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This season is archived.", { exact: false }),
  ).toBeVisible();
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  const add = page.getByRole("button", { name: "Add opponent", exact: true });
  await expect(edit).toBeDisabled();
  await expect(add).toBeDisabled();
  await page.getByLabel("Opponent season").selectOption(second);
  await expect(edit).toBeEnabled();
  await expect(add).toBeEnabled();
  await expect(page.getByText("Archived lead", { exact: false })).toHaveCount(
    0,
  );
});

test("one Edit dialog saves the canonical name and keeps each season's roster independent", async ({
  page,
}) => {
  const profiles = new Map<string, Profile>();
  const writes: Record<string, unknown>[] = [];
  let name = "Canonical Wright";
  await page.route("**/api/team-schedule**", async (route) => {
    if (route.request().method() === "GET") {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("opponentId")).toBe(opponentId);
      await route.fulfill({
        json: {
          opponent: { id: opponentId, displayName: name },
          profile: profiles.get(url.searchParams.get("seasonId")!) ?? null,
        },
      });
      return;
    }
    const body = route.request().postDataJSON();
    writes.push(body);
    expect(body.operation).toBe("updateOpponentDetails");
    expect(body.input.expectedDisplayName).toBe(name);
    const previous = profiles.get(body.input.seasonId);
    expect(body.input.expectedRevision).toBe(previous?.revision ?? 0);
    name = body.input.displayName;
    const profile: Profile = {
      opponent_id: opponentId,
      season_id: body.input.seasonId,
      level: body.input.level,
      roster: body.input.roster,
      revision: (previous?.revision ?? 0) + 1,
    };
    profiles.set(profile.season_id, profile);
    await route.fulfill({
      json: { opponent: { id: opponentId, displayName: name }, profile },
    });
  });
  await directory(page, profiles);
  // Some browsers blur the opener as soon as the directory disables it.
  // Exercise that behavior even when the local browser preserves focus.
  await page.evaluate(() => {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLButtonElement &&
          target.textContent?.trim() === "Edit"
        )
          target.blur();
      },
      true,
    );
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit opponent" });
  await expect(dialog.getByLabel("Saved team name")).toHaveValue(
    "Canonical Wright",
  );
  await dialog.getByLabel("Saved team name").fill("Team Wright renamed");
  await dialog.getByLabel("Competition level").selectOption("U20");
  await dialog.getByLabel("Lead", { exact: true }).fill("Alex Firstseason");
  await dialog.getByLabel("Coach", { exact: true }).fill("Coach Firstseason");
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(1);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("status")).toContainText("2026-27 saved");
  await page.getByLabel("Opponent season").selectOption(second);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel("Saved team name")).toHaveValue(
    "Team Wright renamed",
  );
  await expect(dialog.getByLabel("Lead", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Lead", { exact: true }).fill("Jordan Nextseason");
  await dialog.getByLabel("Competition level").selectOption("Men’s");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Opponent season").selectOption(first);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel("Lead", { exact: true })).toHaveValue(
    "Alex Firstseason",
  );
  await expect(dialog.getByLabel("Coach", { exact: true })).toHaveValue(
    "Coach Firstseason",
  );
  await expect(dialog.getByLabel("Competition level")).toHaveValue("U20");
  expect(writes).toHaveLength(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
});

test("failed loads cannot save and a save conflict preserves fields until explicit reload", async ({
  page,
}) => {
  let reads = 0;
  let writes = 0;
  await page.route("**/api/team-schedule**", async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      await route.fulfill(
        reads === 1
          ? { status: 503, json: { error: "Details temporarily unavailable." } }
          : {
              json: {
                opponent: { id: opponentId, displayName: "Canonical Wright" },
                profile: {
                  opponent_id: opponentId,
                  season_id: first,
                  level: "U20",
                  roster: { ...emptyRoster, lead: "Existing lead" },
                  revision: 3,
                },
              },
            },
      );
      return;
    }
    writes++;
    const body = route.request().postDataJSON();
    expect(body.input.expectedRevision).toBe(3);
    expect(body.input.expectedDisplayName).toBe("Canonical Wright");
    await route.fulfill({
      status: 409,
      json: { error: "Details changed. Reload before saving." },
    });
  });
  await directory(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit opponent" });
  await expect(dialog.getByRole("alert")).toContainText(
    "Details temporarily unavailable.",
  );
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Retry loading details" }).click();
  await expect(dialog.getByLabel("Lead", { exact: true })).toHaveValue(
    "Existing lead",
  );
  await dialog.getByLabel("Saved team name").fill("My unsaved rename");
  await dialog.getByLabel("Lead", { exact: true }).fill("My unsaved lead");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Details changed.");
  await expect(dialog.getByLabel("Saved team name")).toHaveValue(
    "My unsaved rename",
  );
  await expect(dialog.getByLabel("Lead", { exact: true })).toHaveValue(
    "My unsaved lead",
  );
  expect(writes).toBe(1);
  await dialog
    .getByRole("button", {
      name: "Reload saved details (replace these edits)",
      exact: true,
    })
    .click();
  await expect(dialog.getByLabel("Saved team name")).toHaveValue(
    "Canonical Wright",
  );
  await expect(dialog.getByLabel("Lead", { exact: true })).toHaveValue(
    "Existing lead",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("directory creation saves the full opponent in one popup", async ({
  page,
}) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule**", async (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    await route.fulfill({
      status: 201,
      json: {
        opponent: { id: opponentId, displayName: body.input.displayName },
        profile: {
          opponent_id: opponentId,
          season_id: body.input.seasonId,
          level: body.input.level,
          roster: body.input.roster,
          revision: 1,
        },
      },
    });
  });
  await directory(page);
  await page.getByRole("button", { name: "Add opponent", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New opponent" });
  await dialog.getByLabel("Saved team name").fill("Team Spruce");
  await dialog.getByLabel("Competition level").selectOption("U18");
  await dialog.getByLabel("Fourth", { exact: true }).fill("Finley Fourth");
  await dialog.getByLabel("Alternate", { exact: true }).fill("Avery Alternate");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toEqual([
    {
      operation: "createOpponentDetails",
      input: {
        displayName: "Team Spruce",
        seasonId: first,
        level: "U18",
        roster: {
          ...emptyRoster,
          fourth: "Finley Fourth",
          alternate: "Avery Alternate",
        },
        expectedRevision: 0,
      },
    },
  ]);
});

test("game operators create names without gaining season detail controls", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/login?next=%2Fgames%2Fnew");
  await page.getByLabel("Email address").fill("operator@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Schedule a game", exact: true }),
  ).toBeVisible();
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule**", async (route) => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      json: [{ opponent_id: opponentId, display_name: "Operator team" }],
    });
  });
  await page
    .getByRole("button", { name: "Create new opponent", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "New opponent" });
  await expect(dialog.getByLabel("Competition level")).toHaveCount(0);
  await expect(dialog.getByLabel("Lead", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Saved team name").fill("Operator team");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toEqual([
    { operation: "createOpponent", input: { displayName: "Operator team" } },
  ]);
  await expect(
    page.getByLabel("Team 2 — Opponent", { exact: true }),
  ).toHaveValue("Operator team");
  await page.goto("/opponents");
  await expect(
    page.getByRole("heading", { name: "Opponents", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
});
