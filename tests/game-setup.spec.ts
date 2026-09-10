import { expect, test } from "@playwright/test";
test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated Supabase fixture",
);
test.beforeEach(async ({ page }, info) => {
  const target = info.title.startsWith("edit game")
    ? "/games/66666666-6666-4666-8666-000000000002/edit"
    : "/games/new";
  await page.goto(`/login?next=${encodeURIComponent(target)}`);
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${target}`);
});
async function fillGame(page: import("@playwright/test").Page) {
  await page
    .getByLabel("Team 2 — Opponent", { exact: true })
    .selectOption({ label: "Team Wright" });
  await page.getByLabel("Scheduled date (UTC)").fill("2026-10-20");
  await page.getByLabel("Scheduled time (UTC)").fill("18:30");
}
test("duplicate game number can be cleared without losing the game details", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption({ label: "Autumn Club Championship" });
  await page
    .getByLabel("Team 2 — Opponent", { exact: true })
    .selectOption({ label: "Team Wright" });
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
test("summary and saved payload preserve colours, schedule and YouTube settings", async ({
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
  await page.getByText("YouTube broadcast settings", { exact: true }).click();
  await page.getByLabel("Broadcast visibility").selectOption("private");
  await expect(review).toContainText("10 ends");
  await expect(review).toContainText("Private");
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
    timezone: "UTC",
    config: {
      homeColor: "#facc15",
      awayColor: "#2563eb",
      scheduledEnds: 10,
      youtubeVisibility: "private",
    },
  });
  await expect(
    page.getByRole("button", { name: "Schedule game", exact: true }),
  ).toBeEnabled();
  await page.getByText("Rock colours & game length", { exact: true }).click();
  await page.getByText("YouTube broadcast settings", { exact: true }).click();
  await page.screenshot({
    path: info.outputPath(`setup-summary-${info.project.name}.png`),
    fullPage: true,
  });
});
test("unknown opponents are explained and invalid collapsed title settings reopen", async ({
  page,
}) => {
  await fillGame(page);
  await page
    .getByLabel("Team 2 — Opponent", { exact: true })
    .selectOption("__tbd");
  await expect(
    page.getByRole("complementary", { name: "Review game" }),
  ).toContainText("Assign the opponent before scoring begins");
  await page.getByText("YouTube broadcast settings", { exact: true }).click();
  await page.getByRole("button", { name: "Customize title" }).click();
  await page.getByLabel("YouTube title", { exact: false }).fill("");
  await page.getByText("YouTube broadcast settings", { exact: true }).click();
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
  await page.getByText("YouTube broadcast settings", { exact: true }).click();
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

test("new opponents and TBD save the intended opponent without a stale selection", async ({
  page,
}) => {
  await fillGame(page);
  const picker = page.getByLabel("Team 2 — Opponent", { exact: true });
  await picker.selectOption("__new");
  await page.getByLabel("New opponent name").fill("  Team   Granite  ");
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { error: "Try again shortly." } });
  });
  const save = page.getByRole("button", { name: "Schedule game", exact: true });
  await save.click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0]).toMatchObject({ opponentName: "Team Granite" });
  expect(payloads[0]).not.toHaveProperty("opponentId");
  await expect(save).toBeEnabled();
  await picker.selectOption("__tbd");
  await expect(picker).toBeEnabled();
  await save.click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).not.toHaveProperty("opponentId");
  expect(payloads[1]).not.toHaveProperty("opponentName");
  expect(payloads[1]).toMatchObject({ config: { awayName: "Opponent TBD" } });
});

test("edit game preserves the current opponent and allows selecting a saved team", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Edit game", exact: true }),
  ).toBeVisible();
  const picker = page.getByLabel("Team 2 — Opponent", { exact: true });
  await expect(picker).toHaveValue("opponent");
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
  await picker.selectOption({ label: "Team Wright" });
  await save.click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({
    operation: "updateGame",
    opponentId: "77777777-7777-4777-8777-777777777777",
  });
});

test("saving a new opponent adds it to the dropdown and leaving TBD restores selection", async ({
  page,
}) => {
  await fillGame(page);
  const picker = page.getByLabel("Team 2 — Opponent", { exact: true });
  await picker.selectOption("__new");
  await page.getByLabel("New opponent name").fill("  Team   Granite  ");
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/team-schedule", async (route) => {
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    if (payload.operation === "createOpponent") {
      await route.fulfill({
        status: 201,
        json: [
          {
            opponent_id: "88888888-8888-4888-8888-888888888888",
            display_name: "Team Granite",
          },
        ],
      });
    } else
      await route.fulfill({
        status: 503,
        json: { error: "Try again shortly." },
      });
  });
  await page
    .getByRole("button", { name: "Save opponent", exact: true })
    .click();
  await expect(picker).toHaveValue("88888888-8888-4888-8888-888888888888");
  expect(payloads[0]).toEqual({
    operation: "createOpponent",
    input: { displayName: "Team Granite" },
  });
  await expect(page.getByLabel("New opponent name")).toHaveCount(0);
  await picker.selectOption("__tbd");
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: "Team Granite" });
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({
    opponentId: "88888888-8888-4888-8888-888888888888",
    config: { awayName: "Team Granite" },
  });
});
