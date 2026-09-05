import { expect, test } from "@playwright/test";
test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated Supabase fixture",
);
test.beforeEach(async ({ page }) => {
  await page.goto("/login?next=/games/new");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/games/new");
});
async function fillGame(page: import("@playwright/test").Page) {
  await page
    .getByLabel("Team 2 — Opponent", { exact: true })
    .fill("Team Wright");
  await page.getByLabel("Scheduled date (UTC)").fill("2026-10-20");
  await page.getByLabel("Scheduled time (UTC)").fill("18:30");
}
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
  await page.getByLabel("Opponent TBD", { exact: true }).check();
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
