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
  await page
    .getByRole("combobox", { name: "Opponent", exact: true })
    .fill("Wright");
  await page.getByRole("option", { name: "Team Wright", exact: true }).click();
  await page.locator('input[name="scheduledDate"]').fill("2026-10-20");
  await page.locator('input[name="scheduledTime"]').fill("18:30");
}

test("the Event add button chooses its season and preserves the game draft", async ({
  page,
}) => {
  await fillGame(page);
  await page
    .getByRole("combobox", { name: "Ends", exact: true })
    .selectOption("10");
  const eventButton = page.getByRole("button", {
    name: "Create event",
    exact: true,
  });
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
  await eventButton.click();
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
  await expect(eventButton).toBeFocused();
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
  await expect(
    page.getByRole("combobox", { name: "Opponent", exact: true }),
  ).toHaveValue("Team Wright");
  await expect(page.locator('input[name="scheduledDate"]')).toHaveValue(
    "2026-10-20",
  );
  await expect(page.locator('input[name="scheduledTime"]')).toHaveValue(
    "18:30",
  );
  await expect(
    page.getByRole("combobox", { name: "Ends", exact: true }),
  ).toHaveValue("10");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?season=/);
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
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
  const picker = page.getByRole("combobox", { name: "Opponent", exact: true });
  await expect(picker).toHaveValue("TBD");
  await picker.focus();
  await expect(
    page.getByRole("option", { name: "Team Wright", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "TBD", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: "Team Wright", exact: true }).click();
  await expect(picker).toHaveValue("Team Wright");
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
  await picker.click();
  await expect(
    page.getByRole("option", { name: "TBD", exact: true }),
  ).toBeVisible();
});

test("schedules multiple games from the form and returns directly to Games", async ({
  page,
}) => {
  const season = page.getByRole("combobox", { name: "Season", exact: true });
  const event = page.getByRole("combobox", { name: "Event", exact: true });
  const time = page.locator('input[name="scheduledTime"]');
  const another = page.getByRole("button", {
    name: "Schedule and Create Another",
    exact: true,
  });
  await event.selectOption({ label: "Autumn Club Championship" });
  await fillGame(page);
  await page.locator('input[name="scheduledDate"]').fill("2026-09-12");
  const selectedSeason = await season.inputValue();
  const selectedEvent = await event.inputValue();
  await expect(page.getByLabel("Game number (optional)")).toHaveCount(0);
  const payloads: Record<string, any>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    await route.fulfill({
      json: { game: { id: payload.gameId } },
    });
  });

  await another.click();
  await expect(time).toHaveValue("");
  await expect(season).toHaveValue(selectedSeason);
  await expect(event).toHaveValue(selectedEvent);
  await expect(
    page.getByRole("combobox", { name: "Opponent", exact: true }),
  ).toHaveValue("Team Wright");
  await expect(page.locator('input[name="scheduledDate"]')).toHaveValue(
    "2026-09-12",
  );
  await expect(page).toHaveURL(/\/games\/new(?:\?|$)/);
  await expect(
    page.getByRole("heading", { name: "Schedule game", exact: true }),
  ).toBeVisible();

  await time.fill("20:30");
  await another.click();
  await expect(time).toHaveValue("");
  await expect(event).toHaveValue(selectedEvent);
  await expect(
    page.getByRole("combobox", { name: "Opponent", exact: true }),
  ).toHaveValue("Team Wright");
  await time.fill("21:30");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp("/dashboard\\?season=" + selectedSeason + "$"),
  );
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
  expect(payloads.map((payload) => payload.gameNumber)).toEqual([6, 7, 8]);
  expect(payloads.map((payload) => payload.eventId)).toEqual([
    selectedEvent,
    selectedEvent,
    selectedEvent,
  ]);
  expect(new Set(payloads.map((payload) => payload.gameId)).size).toBe(3);
});

test("an automatically assigned game number can be cleared after a conflict", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption({ label: "Autumn Club Championship" });
  await fillGame(page);
  await page.locator('input[name="scheduledDate"]').fill("2026-09-12");
  const payloads: Record<string, unknown>[] = [];
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
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "game number is already used" }),
  ).toContainText("game number is already used");
  expect(payloads[0]).toMatchObject({ gameNumber: 6 });
  const number = page.getByLabel("Game number (optional)");
  await expect(number).toHaveValue("6");
  await number.fill("");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({
    gameNumber: null,
    opponentId: payloads[0].opponentId,
    scheduledDate: "2026-09-12",
    scheduledTime: "18:30",
  });
});
test("rock colour choices and an unlisted YouTube reservation are saved", async ({
  page,
}) => {
  await fillGame(page);
  const chooseColours = page.getByRole("switch", { name: "Choose now" });
  const yellow = page.getByRole("radio", {
    name: "Test Curling Club: Yellow",
    exact: true,
  });
  const blue = page.getByRole("radio", { name: "Opponent: Blue", exact: true });
  await expect(chooseColours).toBeChecked();
  await yellow.check();
  await expect(blue).toBeChecked();
  await chooseColours.uncheck();
  await expect(yellow).toBeHidden();
  await expect(blue).toBeHidden();
  await chooseColours.check();
  await expect(yellow).toBeChecked();
  await chooseColours.uncheck();
  await page
    .getByRole("combobox", { name: "Ends", exact: true })
    .selectOption("10");
  await page.getByRole("switch", { name: "YouTube streaming" }).check();
  await expect(
    page.getByRole("switch", { name: "Broadcast visibility" }),
  ).not.toBeChecked();
  const payloads: unknown[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    payloads.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ status: 503, json: { error: "Try again shortly." } });
  });
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(
    page.locator(".setup-form button[type=submit]:enabled"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Opponent", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "Try again shortly." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/games\/new(?:\?|$)/);
  await expect(page.locator('input[name="scheduledDate"]')).toHaveValue(
    "2026-10-20",
  );
  await expect(page.locator('input[name="scheduledTime"]')).toHaveValue(
    "18:30",
  );
  await expect(
    page.getByRole("combobox", { name: "Opponent", exact: true }),
  ).toHaveValue("Team Wright");
  await expect(
    page.getByRole("button", {
      name: "Schedule and Create Another",
      exact: true,
    }),
  ).toBeEnabled();
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
    page.getByRole("button", { name: "Schedule", exact: true }),
  ).toBeEnabled();
});

test("YouTube options switch between a shared link and a public reservation", async ({
  page,
}) => {
  await fillGame(page);
  const streaming = page.getByRole("switch", { name: "YouTube streaming" });
  const visibility = page.getByRole("switch", { name: "Broadcast visibility" });
  const title = page.getByLabel("YouTube title", { exact: true });
  const link = page.getByLabel("Paste the YouTube link", { exact: true });
  const sharedUrl = "https://youtu.be/abcdefghijk";
  await expect(streaming).not.toBeChecked();
  await expect(title).toBeHidden();
  await expect(visibility).toBeHidden();
  await link.fill(sharedUrl);
  await streaming.click();
  await expect(link).toBeHidden();
  await expect(title).toHaveValue(/Team Wright/);
  await title.fill("Club championship live");
  await expect(visibility).not.toBeChecked();
  await visibility.click();
  await expect(visibility).toBeChecked();
  await streaming.click();
  await expect(title).toBeHidden();
  await expect(visibility).toBeHidden();
  await expect(link).toHaveValue(sharedUrl);
  await streaming.click();
  await expect(visibility).toBeChecked();
  await expect(title).toHaveValue("Club championship live");
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
    .getByRole("button", { name: "Schedule and Create Another", exact: true })
    .click();
  await expect(page.locator('input[name="scheduledTime"]')).toHaveValue("");
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toMatchObject({
    operation: "createGame",
    config: {
      youtubeEnabled: true,
      youtubeVisibility: "public",
      youtubeTitle: "Club championship live",
      sharedYoutubeWatchUrl: "",
    },
  });
  expect(postUrls).toHaveLength(1);
  expect(postUrls[0]).toMatch(/\/api\/team-schedule$/);
  await expect(streaming).toBeChecked();
  await expect(visibility).toBeChecked();
});

test("an inline YouTube warning retries the saved game and honors Schedule", async ({
  page,
}) => {
  await fillGame(page);
  await page.getByRole("switch", { name: "YouTube streaming" }).click();
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
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.locator(".setup-form").getByRole("status")).toContainText(
    "Check this channel's Live list",
  );
  await expect(page).toHaveURL(/\/games\/new(?:\?|$)/);
  await expect(
    page.getByRole("heading", { name: "Schedule game" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry YouTube" }).click();
  await expect(page).toHaveURL(/\/dashboard\?season=/);
  expect(payloads.map((item) => item.operation)).toEqual([
    "createGame",
    "retryYouTube",
  ]);
  expect(payloads[1].gameId).toBe(payloads[0].gameId);
});

test("continues to another game after a YouTube warning without scheduling a duplicate", async ({
  page,
}) => {
  await fillGame(page);
  await page.getByRole("switch", { name: "YouTube streaming" }).check();
  const operations: string[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    operations.push(payload.operation);
    await route.fulfill({
      json: {
        game: { id: payload.gameId },
        youtube: {
          status: "pending",
          errorCode: "broadcast_operation_uncertain",
        },
      },
    });
  });
  const another = page.getByRole("button", {
    name: "Schedule and Create Another",
    exact: true,
  });
  await another.click();
  await expect(
    page.getByRole("button", { name: "Retry YouTube" }),
  ).toBeVisible();
  await another.click();
  await expect(page.locator('input[name="scheduledTime"]')).toHaveValue("");
  await expect(page.getByRole("button", { name: "Retry YouTube" })).toHaveCount(
    0,
  );
  await expect(page).toHaveURL(/\/games\/new(?:\?|$)/);
  expect(operations).toEqual(["createGame"]);
});
test("an empty YouTube title blocks reservation until it is filled", async ({
  page,
}) => {
  await fillGame(page);
  await page.getByRole("switch", { name: "YouTube streaming" }).click();
  const title = page.getByLabel("YouTube title", { exact: true });
  await title.fill("");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(title).toBeFocused();
  expect(
    await title.evaluate(
      (input: HTMLInputElement) => input.validity.valueMissing,
    ),
  ).toBe(true);
});
test("the game fields form two rows of four on desktop and fit on phones", async ({
  page,
}, info) => {
  await fillGame(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const labels = [
    "Season",
    "Event",
    "Date",
    "Time",
    "Team",
    "Opponent",
    "Timezone",
    "Ends",
  ];
  const boxes = await Promise.all(
    labels.map((label) =>
      (["Season", "Event", "Opponent", "Timezone", "Ends"].includes(label)
        ? page.getByRole("combobox", { name: label, exact: true })
        : page.getByLabel(label, { exact: true })
      ).boundingBox(),
    ),
  );
  for (const start of [0, 4]) {
    for (let index = start; index < start + 4; index++) {
      const box = boxes[index]!;
      expect(box.y).toBeCloseTo(boxes[start]!.y, 0);
      if (index > start) {
        const previous = boxes[index - 1]!;
        expect(box.x).toBeGreaterThan(previous.x + previous.width);
      }
    }
  }
  expect(boxes[4]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
  for (const [column, name] of [
    [1, "Create event"],
    [5, "Create new opponent"],
  ] as const) {
    const add = await page
      .getByRole("button", { name, exact: true })
      .boundingBox();
    const field = boxes[column]!;
    expect(add!.x).toBeGreaterThanOrEqual(field.x + field.width);
    expect(add!.y).toBeCloseTo(field.y, 0);
    expect(add!.width).toBeGreaterThanOrEqual(44);
    expect(add!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("switch", { name: "YouTube streaming" }).click();
  await page.screenshot({
    path: info.outputPath("setup-desktop.png"),
    fullPage: true,
  });

  for (const width of [900, 390, 320]) {
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
    if (width === 390)
      await page.screenshot({
        path: info.outputPath("setup-mobile.png"),
        fullPage: true,
      });
  }
  await page.screenshot({
    path: info.outputPath("setup-narrow.png"),
    fullPage: true,
  });
});

test("unmatched search cannot save a stale opponent and clearing restores TBD", async ({
  page,
}) => {
  await fillGame(page);
  const picker = page.getByRole("combobox", { name: "Opponent", exact: true });
  await picker.fill("No Such Opponent");
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "Try again shortly." } });
  });
  const save = page.getByRole("button", { name: "Schedule", exact: true });
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
  const picker = page.getByRole("combobox", { name: "Opponent", exact: true });
  await expect(picker).toHaveValue("Team Wright");
  const gameNumber = page.getByLabel("Game number (optional)");
  await expect(gameNumber).toHaveValue("5");
  await gameNumber.fill("12");
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
    gameNumber: 12,
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
  const visibility = page.getByRole("switch", { name: "Broadcast visibility" });
  await expect(visibility).toBeChecked();
  await expect(visibility).toBeDisabled();
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
  await expect(visibility).toBeChecked();
});

test("edit game keeps reserved unlisted visibility fixed", async ({ page }) => {
  const streaming = page.getByRole("switch", { name: "YouTube streaming" });
  const visibility = page.getByRole("switch", { name: "Broadcast visibility" });
  await expect(visibility).not.toBeChecked();
  await expect(visibility).toBeDisabled();
  await streaming.click();
  await expect(visibility).toBeHidden();
  await streaming.click();
  await expect(visibility).not.toBeChecked();
  await expect(visibility).toBeDisabled();
});

test("saving a new opponent adds it to search and leaving TBD restores selection", async ({
  page,
}) => {
  await fillGame(page);
  const picker = page.getByRole("combobox", { name: "Opponent", exact: true });
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
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({
    opponentId: "88888888-8888-4888-8888-888888888888",
    config: { awayName: "Team Granite" },
  });
});
