import { expect, test } from "@playwright/test";
test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated Supabase fixture",
);
function reservedFixtureIds(info: import("@playwright/test").TestInfo) {
  const suffix = info.project.name === "mobile" ? "15" : "13";
  const kind = info.title.includes("reserved public") ? "1" : "2";
  return {
    gameId: `66666666-6666-4666-8666-000000000${suffix}${kind}`,
    seasonId: `33333333-3333-4333-8333-000000000${suffix}${kind}`,
    eventId: `55555555-5555-4555-8555-000000000${suffix}${kind}`,
  };
}
test.beforeEach(async ({ page, request }, info) => {
  const reserved = /reserved (public|unlisted)/.test(info.title);
  if (reserved) {
    const response = await request.post(
      "http://127.0.0.1:3101/__dashboard-completion-fixture",
      {
        data: {
          ...reservedFixtureIds(info),
          days: 2,
          seasonStatus: "draft",
          config: {
            awayName: "Team Wright",
            youtubeEnabled: true,
            youtubeVisibility: info.title.includes("reserved public")
              ? "public"
              : "unlisted",
          },
          youtubeScheduledStatus: "ready",
          youtubeScheduledWatchUrl:
            "https://www.youtube.com/watch?v=abcdefghijk",
        },
      },
    );
    expect(response.ok()).toBe(true);
  }
  const target = info.title.startsWith("edit game")
    ? `/games/${reserved ? reservedFixtureIds(info).gameId : "66666666-6666-4666-8666-000000000002"}/edit`
    : "/games/new";
  await page.goto(`/login?next=${encodeURIComponent(target)}`);
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${target}`);
});
test.afterEach(async ({ request }, info) => {
  if (/reserved (public|unlisted)/.test(info.title)) {
    const response = await request.delete(
      "http://127.0.0.1:3101/__dashboard-completion-fixture",
      { data: { seasonId: reservedFixtureIds(info).seasonId } },
    );
    expect(response.ok()).toBe(true);
  }
});
async function fillGame(page: import("@playwright/test").Page) {
  await page.getByLabel("Team 2 — Opponent", { exact: true }).fill("Wright");
  await page.getByRole("option", { name: "Team Wright", exact: true }).click();
  await page.locator('input[name="scheduledDate"]').fill("2026-10-20");
  await page.locator('input[name="scheduledTime"]').fill("18:30");
}

test("top Create event chooses its season and preserves the game draft", async ({
  page,
}) => {
  await fillGame(page);
  await page.getByText("Rock colours & game length", { exact: true }).click();
  await page.getByLabel("Scheduled ends").selectOption("10");
  const payloads: Record<string, any>[] = [];
  const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-111111111111";
  const newSeasonId = "aaaaaaaa-aaaa-4aaa-8aaa-222222222222";
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    await route.fulfill({
      json:
        payload.operation === "createSeason"
          ? newSeasonId
          : payload.operation === "createEvent"
            ? eventId
            : { game: { id: payload.gameId } },
    });
  });
  await page
    .getByRole("combobox", { name: "Season", exact: true })
    .selectOption("__new");
  const seasonDialog = page.getByRole("dialog", {
    name: "Create New Season",
    exact: true,
  });
  await seasonDialog
    .getByLabel("Name", { exact: true })
    .fill("2026–27 Exhibition season");
  await seasonDialog
    .getByLabel("Start date", { exact: true })
    .fill("2026-09-01");
  await seasonDialog.getByLabel("End date", { exact: true }).fill("2027-04-01");
  await seasonDialog
    .getByRole("button", { name: "Create season", exact: true })
    .click();
  await expect(seasonDialog).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Season", exact: true })
    .selectOption("33333333-3333-4333-8333-333333333333");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Create New Event",
    exact: true,
  });
  const seasonPicker = dialog.getByRole("combobox", {
    name: "Season",
    exact: true,
  });
  await expect(seasonPicker).toHaveValue(
    "33333333-3333-4333-8333-333333333333",
  );
  await seasonPicker.selectOption(newSeasonId);
  await dialog.getByLabel("Name", { exact: true }).fill("Granite Invitational");
  await dialog
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("bonspiel");
  await dialog.getByLabel("Start date", { exact: true }).fill("2026-10-19");
  await dialog.getByLabel("End date", { exact: true }).fill("2026-10-22");
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toMatchObject({
    operation: "createEvent",
    input: {
      seasonId: newSeasonId,
      name: "Granite Invitational",
      eventType: "bonspiel",
    },
  });
  await expect(
    page.getByRole("combobox", { name: "Event", exact: true }),
  ).toHaveValue(eventId);
  await expect(
    page.getByRole("combobox", { name: "Season", exact: true }),
  ).toHaveValue(newSeasonId);
  await expect(page.getByLabel("Game number (optional)")).toHaveValue("1");
  await expect(
    page.getByLabel("Team 2 — Opponent", { exact: true }),
  ).toHaveValue("Team Wright");
  await expect(page.locator('input[name="scheduledDate"]')).toHaveValue(
    "2026-10-20",
  );
  await expect(page.locator('input[name="scheduledTime"]')).toHaveValue(
    "18:30",
  );
  await expect(page.getByLabel("Scheduled ends")).toHaveValue("10");
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Game scheduled", exact: true }),
  ).toBeVisible();
  expect(payloads[2]).toMatchObject({
    operation: "createGame",
    eventId,
    gameNumber: 1,
    opponentId: "77777777-7777-4777-8777-777777777777",
    scheduledDate: "2026-10-20",
    scheduledTime: "18:30",
    config: { scheduledEnds: 10 },
  });
});

test("opponent search starts at TBD and supports keyboard selection and cancellation", async ({
  page,
}) => {
  const picker = page.getByLabel("Team 2 — Opponent", { exact: true });
  await expect(picker).toHaveValue("TBD");
  await picker.focus();
  await expect(
    page.getByRole("listbox", { name: "Matching opponents" }),
  ).toHaveCount(0);
  await picker.fill("  wRiGhT ");
  await expect(
    page.getByRole("option", { name: "Team Wright", exact: true }),
  ).toBeVisible();
  await picker.press("ArrowDown");
  await expect(picker).toHaveAttribute(
    "aria-activedescendant",
    "setup-opponent-results-0",
  );
  await picker.press("Enter");
  await expect(picker).toHaveValue("Team Wright");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await picker.fill("Unknown team");
  await picker.press("Escape");
  await expect(picker).toHaveValue("Team Wright");
  await picker.fill("");
  await expect(picker).toHaveValue("TBD");
  await expect(
    page
      .getByRole("listbox", { name: "Matching opponents" })
      .getByRole("option"),
  ).toHaveCount(0);
});

test("schedules multiple games with the same event and distinct save keys", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption({ label: "Autumn Club Championship" });
  await fillGame(page);
  await page.locator('input[name="scheduledDate"]').fill("2026-09-12");
  await expect(page.getByLabel("Game number (optional)")).toHaveValue("6");
  const payloads: Record<string, any>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    payloads.push(payload);
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
  await page.getByRole("button", { name: "Yes, schedule another" }).click();
  await expect(
    page.getByRole("combobox", { name: "Event", exact: true }),
  ).toHaveValue(payloads[0].eventId);
  await expect(page.locator('input[name="scheduledDate"]')).toHaveValue(
    "2026-09-12",
  );
  await expect(page.locator('input[name="scheduledTime"]')).toHaveValue("");
  await expect(page.getByLabel("Game number (optional)")).toHaveValue("7");
  await page.getByLabel("Game number (optional)").fill("12");
  await page.locator('input[name="scheduledTime"]').fill("20:30");
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Game scheduled", exact: true }),
  ).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[1].gameId).not.toBe(payloads[0].gameId);
  expect(payloads[1].eventId).toBe(payloads[0].eventId);
  expect(payloads.map((payload) => payload.gameNumber)).toEqual([6, 12]);
  expect(payloads[1].config).toMatchObject({
    scheduledEnds: payloads[0].config.scheduledEnds,
  });
  await page.getByRole("button", { name: "Yes, schedule another" }).click();
  await expect(page.getByLabel("Game number (optional)")).toHaveValue("13");
  await page.locator('input[name="scheduledTime"]').fill("21:30");
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Game scheduled", exact: true }),
  ).toBeVisible();
  expect(payloads.map((payload) => payload.gameNumber)).toEqual([6, 12, 13]);
  expect(new Set(payloads.map((payload) => payload.gameId)).size).toBe(3);
  await page.getByRole("button", { name: "No, I’m finished" }).click();
  await expect(
    page.getByRole("heading", { name: "Open the last game?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "No, view all games" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
test("duplicate game number can be cleared without losing the game details", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption({ label: "Autumn Club Championship" });
  await page.getByLabel("Team 2 — Opponent", { exact: true }).fill("Wright");
  await page.getByRole("option", { name: "Team Wright", exact: true }).click();
  await page.locator('input[name="scheduledDate"]').fill("2026-09-12");
  await page.locator('input[name="scheduledTime"]').fill("18:30");
  await page.getByLabel("Game number (optional)").fill("5");
  const payloads: { gameNumber: number | null; opponentId?: string }[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({
      status: 409,
      json: {
        error:
          "That game number is already used in this event. Choose another number or leave the optional game number blank.",
      },
    });
  });
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Yes, use this number" }),
  ).toBeVisible();
  expect(payloads).toHaveLength(0);
  await page.getByRole("button", { name: "Yes, use this number" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "game number is already used" }),
  ).toContainText("game number is already used");
  await page.getByRole("button", { name: "Leave game unnumbered" }).click();
  await expect(page.getByLabel("Game number (optional)")).toHaveValue("");
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({
    gameNumber: null,
    opponentId: payloads[0].opponentId,
  });
});
test("summary and saved payload reserve an unlisted YouTube watch page", async ({
  page,
}, info) => {
  await fillGame(page);
  const review = page.getByRole("complementary", { name: "Review game" });
  await expect(review).toContainText("Team Wright");
  await expect(review).toContainText("Oct 20, 2026");
  await page.getByText("Rock colours & game length", { exact: true }).click();
  await page
    .getByRole("radio", { name: "Team 1 rock colour: Yellow", exact: true })
    .check();
  await page.getByLabel("Scheduled ends").selectOption("10");
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  await page.getByRole("radio", { name: "Yes" }).check();
  await expect(page.getByLabel("Broadcast visibility")).toHaveValue("unlisted");
  await expect(review).toContainText("10 ends");
  await expect(review).toContainText("YouTube watch link will be reserved");
  await expect(review).toContainText("Unlisted");
  const payloads: unknown[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    payloads.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ status: 503, json: { error: "Try again shortly." } });
  });
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(
    page.getByLabel("Team 2 — Opponent", { exact: true }),
  ).toBeDisabled();
  await expect(review.getByRole("alert")).toContainText("Try again shortly.");
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toMatchObject({
    operation: "createGame",
    opponentId: "77777777-7777-4777-8777-777777777777",
    scheduledDate: "2026-10-20",
    scheduledTime: "18:30",
    timezone: "America/Toronto",
    config: {
      homeColor: "#facc15",
      awayColor: "#2563eb",
      scheduledEnds: 10,
      youtubeEnabled: true,
      youtubeVisibility: "unlisted",
    },
  });
  await expect(
    page.getByRole("button", { name: "Schedule game", exact: true }),
  ).toBeEnabled();
  await page.getByText("Rock colours & game length", { exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  await page.screenshot({
    path: info.outputPath(`setup-summary-${info.project.name}.png`),
    fullPage: true,
  });
});

test("public YouTube visibility is explained, retained and saved without starting a stream", async ({
  page,
}) => {
  await fillGame(page);
  const streaming = page.locator("summary").filter({ hasText: /^Streaming/ });
  await streaming.click();
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
  const visibility = page.getByLabel("Broadcast visibility");
  await expect(visibility).toHaveValue("unlisted");
  await visibility.selectOption("public");
  await expect(page.locator("#youtube-visibility-help")).toContainText(
    "anyone can find and watch this game on YouTube",
  );
  await expect(page.locator("#youtube-visibility-help")).toContainText(
    "you start the stream manually",
  );
  await expect(streaming).toContainText("reserve a public YouTube watch link");
  await expect(
    page.getByRole("complementary", { name: "Review game" }),
  ).toContainText("YouTube watch link will be reserved · Public");
  await page.getByRole("radio", { name: "No / shared link" }).check();
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
  await expect(visibility).toHaveValue("public");
  const payloads: Record<string, unknown>[] = [];
  const postUrls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") postUrls.push(request.url());
  });
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    await route.fulfill({
      json: {
        game: { id: payload.gameId },
        youtube: { status: "ready", thumbnailStatus: "ready" },
      },
    });
  });
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Game scheduled", exact: true }),
  ).toBeVisible();
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toMatchObject({
    operation: "createGame",
    config: { youtubeEnabled: true, youtubeVisibility: "public" },
  });
  expect(postUrls).toHaveLength(1);
  expect(postUrls[0]).toMatch(/\/api\/team-schedule$/);
  await page.getByRole("button", { name: "Yes, schedule another" }).click();
  await streaming.click();
  await expect(visibility).toHaveValue("public");
});

test("a pending YouTube page explains the uncertainty and retries the same game", async ({
  page,
}) => {
  await fillGame(page);
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  await page.getByRole("radio", { name: "Yes" }).check();
  const payloads: { operation: string; gameId: string }[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    await route.fulfill({
      json: {
        game: { id: payload.gameId },
        youtube:
          payload.operation === "createGame"
            ? { status: "pending", errorCode: "broadcast_operation_uncertain" }
            : { status: "ready", thumbnailStatus: "ready" },
      },
    });
  });
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Check this channel's Live list",
  );
  await page.getByRole("button", { name: "Retry YouTube" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(payloads.map((item) => item.operation)).toEqual([
    "createGame",
    "retryYouTube",
  ]);
  expect(payloads[1].gameId).toBe(payloads[0].gameId);
});
test("unknown opponents are explained and invalid collapsed title settings reopen", async ({
  page,
}) => {
  await fillGame(page);
  await page.getByLabel("Team 2 — Opponent", { exact: true }).fill("");
  await expect(
    page.getByRole("complementary", { name: "Review game" }),
  ).toContainText("Assign the opponent before scoring begins");
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("button", { name: "Customize title" }).click();
  await page.getByLabel("YouTube title", { exact: false }).fill("");
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(page.locator('input[name="youtubeTitle"]')).toBeVisible();
  await expect(page.locator('input[name="youtubeTitle"]')).toBeFocused();
});
test("expanded options stay inside the setup form on phones and small laptops", async ({
  page,
}, info) => {
  await fillGame(page);
  await page.getByText("Rock colours & game length", { exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  for (const width of [900, 320]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.locator(".setup-form").evaluate((form) =>
        [
          ...form.querySelectorAll(
            "input:not([type=hidden]),select,button,fieldset",
          ),
        ]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.right > innerWidth;
          })
          .map((e) => e.tagName),
      ),
    ).toEqual([]);
  }
  await page.screenshot({
    path: info.outputPath(`setup-expanded-${info.project.name}.png`),
    fullPage: true,
  });
});

test("unmatched search cannot save a stale opponent and clearing restores TBD", async ({
  page,
}) => {
  await fillGame(page);
  const picker = page.getByLabel("Team 2 — Opponent", { exact: true });
  await picker.fill("No Such Opponent");
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "Try again shortly." } });
  });
  const save = page.getByRole("button", { name: "Schedule game", exact: true });
  await expect(save).toBeDisabled();
  await expect(
    page
      .getByRole("listbox", { name: "Matching opponents" })
      .getByRole("option"),
  ).toHaveCount(0);
  expect(payloads).toHaveLength(0);
  await picker.fill("");
  await expect(save).toBeEnabled();
  await expect(picker).toBeEnabled();
  await save.click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0]).not.toHaveProperty("opponentId");
  expect(payloads[0]).not.toHaveProperty("opponentName");
  expect(payloads[0]).toMatchObject({ config: { awayName: "Opponent TBD" } });
});

test("edit game preserves the current opponent and allows selecting a saved team", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Edit game", exact: true }),
  ).toBeVisible();
  const picker = page.getByLabel("Team 2 — Opponent", { exact: true });
  await expect(picker).toHaveValue("Team Wright");
  await page.locator('input[name="scheduledDate"]').fill("2026-09-12");
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "Try again shortly." } });
  });
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await save.click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0]).toMatchObject({
    operation: "updateGame",
    opponentId: "opponent",
  });
  await expect(save).toBeEnabled();
  await picker.fill("Wright");
  await page.getByRole("option", { name: "Team Wright", exact: true }).click();
  await save.click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({
    operation: "updateGame",
    opponentId: "77777777-7777-4777-8777-777777777777",
  });
});

test("edit game retains reserved public visibility", async ({ page }) => {
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
  await expect(page.getByLabel("Broadcast visibility")).toHaveValue("public");
  await expect(page.getByLabel("Broadcast visibility")).toBeDisabled();
  await expect(page.locator("#youtube-visibility-help")).toContainText(
    "Visibility is fixed once YouTube watch-page reservation begins",
  );
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "Try again shortly." } });
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0]).toMatchObject({
    operation: "updateGame",
    config: { youtubeEnabled: true, youtubeVisibility: "public" },
  });
  await expect(page.getByLabel("Broadcast visibility")).toHaveValue("public");
});

test("edit game keeps reserved unlisted visibility fixed", async ({ page }) => {
  await page
    .locator("summary")
    .filter({ hasText: /^Streaming/ })
    .click();
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
  const visibility = page.getByLabel("Broadcast visibility");
  await expect(visibility).toHaveValue("unlisted");
  await expect(visibility).toBeDisabled();
  await expect(page.locator("#youtube-visibility-help")).toContainText(
    "Choose Public when scheduling a future game",
  );
  await page.getByRole("radio", { name: "No / shared link" }).check();
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
  await expect(visibility).toHaveValue("unlisted");
  await expect(visibility).toBeDisabled();
});

test("saving a new opponent adds it to search and leaving TBD restores selection", async ({
  page,
}) => {
  await fillGame(page);
  const picker = page.getByLabel("Team 2 — Opponent", { exact: true });
  await page
    .getByRole("button", { name: "Create new opponent", exact: true })
    .click();
  await page.getByLabel("Saved team name").fill("Team Granite");
  const opponentDialog = page.getByRole("dialog", {
    name: "New opponent",
    exact: true,
  });
  await expect(
    opponentDialog.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(1);
  await opponentDialog
    .getByRole("combobox", { name: "Competition level", exact: true })
    .selectOption("U20");
  await opponentDialog.getByLabel("Lead", { exact: true }).fill("Alex Lead");
  await opponentDialog.getByLabel("Fourth", { exact: true }).fill("Sam Skip");
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    if (
      payload.operation === "createOpponent" ||
      payload.operation === "createOpponentDetails"
    ) {
      await route.fulfill({
        status: 201,
        json:
          payload.operation === "createOpponent"
            ? [
                {
                  opponent_id: "88888888-8888-4888-8888-888888888888",
                  display_name: "Team Granite",
                },
              ]
            : {
                opponent: {
                  id: "88888888-8888-4888-8888-888888888888",
                  displayName: "Team Granite",
                },
                profile: {
                  opponent_id: "88888888-8888-4888-8888-888888888888",
                  season_id: payload.input.seasonId,
                  level: payload.input.level,
                  roster: payload.input.roster,
                  revision: 1,
                },
              },
      });
    } else
      await route.fulfill({
        status: 503,
        json: { error: "Try again shortly." },
      });
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(picker).toHaveValue("Team Granite");
  expect(payloads[0]).toMatchObject({
    operation: "createOpponentDetails",
    input: {
      displayName: "Team Granite",
      seasonId: "33333333-3333-4333-8333-333333333333",
      level: "U20",
      roster: { lead: "Alex Lead", fourth: "Sam Skip" },
      expectedRevision: 0,
    },
  });
  expect(payloads).toHaveLength(1);
  await expect(page.getByLabel("Saved team name")).toHaveCount(0);
  await picker.fill("");
  await expect(picker).toBeEnabled();
  await picker.fill("Granite");
  await page.getByRole("option", { name: "Team Granite", exact: true }).click();
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({
    opponentId: "88888888-8888-4888-8888-888888888888",
    config: { awayName: "Team Granite" },
  });
});
