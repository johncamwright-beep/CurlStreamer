import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
test("flagged-shot menu retains filters and exposes review links and editable times", async ({
  page,
}) => {
  let latestEvent = "";
  await page.route("**/api/curlcoach/workspace?**", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.catalog?.forEach(
      (event: { id: string; startDate?: string }, index: number) => {
        event.startDate = `${2020 + index}-01-01`;
        latestEvent = event.id;
      },
    );
    for (const game of data.event?.games ?? []) {
      game.standaloneReviews = [
        {
          id: "33333333-3333-4333-8333-333333333333",
          audience: "team",
          playerId: null,
          playerName: null,
          note: "Standalone sweep review",
          selectedAt: "2026-11-10T15:00:00Z",
        },
      ];
      const entry = game.state.events.find((e: { shot?: unknown }) => e.shot);
      if (entry)
        entry.shot = {
          ...entry.shot,
          flagged: true,
          videoReview: {
            url: "https://www.youtube.com/watch?v=abcdefghijk",
            positionSeconds: 132,
            lookBackSeconds: 0,
          },
        };
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto("/curlcoach");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  const menu = page.getByRole("navigation", { name: "Shot Tracker pages" });
  await expect(menu.getByRole("link")).toHaveText([
    "Charting",
    "Analysis",
    "Reports",
  ]);
  await menu.getByRole("link", { name: "Analysis", exact: true }).click();
  const flagged = page.getByRole("tab", { name: "Flagged shots", exact: true });
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("practice");
  const chosenEvent = await page
    .getByRole("combobox", { name: "Event", exact: true })
    .inputValue();
  await flagged.click();
  await expect(flagged).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/#analysis\/flagged$/);
  await expect(
    page.getByRole("heading", { name: "Flagged shots", exact: true }),
  ).toBeVisible();
  await expect.poll(() => latestEvent).not.toBe("");
  await expect(
    page.getByRole("combobox", { name: "Event", exact: true }),
  ).toHaveValue(chosenEvent);
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("all");
  await expect(
    page.getByRole("region", { name: "Flagged shots", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Flagged shots", exact: true })
      .getByText("Standalone sweep review", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Video start time").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Review video from/ }).first(),
  ).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=abcdefghijk&t=132s",
  );
  await page.getByLabel("Video start time").first().fill("2:12");
  await expect(page.getByLabel("Video start time").first()).toHaveValue("2:12");
  await expect(page.getByLabel("Coach’s notes").first()).toBeVisible();
  await page
    .getByRole("combobox", { name: "Team / player", exact: true })
    .selectOption("lead");
  await expect(
    page.getByRole("combobox", { name: "Team / player", exact: true }),
  ).toHaveValue("lead");
  await page
    .getByRole("link", { name: "Charting", exact: true })
    .first()
    .click();
  if (
    !(await page
      .getByRole("button", { name: "Flagged shots", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Game controls", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Flagged shots", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Standalone sweep review", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
