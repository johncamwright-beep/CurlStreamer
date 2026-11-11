import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
test("flagged-shot menu retains filters and shows one timestamped link per flag", async ({
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
      game.broadcastReview = {
        url: "https://youtu.be/Replacement",
        startedAt: "2026-11-10T16:00:00Z",
        previous: [
          {
            url: "https://youtu.be/EarlierFilm",
            startedAt: "2026-11-10T14:58:00Z",
            endedAt: "2026-11-10T15:30:00Z",
            estimated: true,
          },
        ],
      };
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
  const standalone = page
    .getByRole("region", { name: "Flagged shots", exact: true })
    .getByRole("article")
    .filter({
      has: page.getByText("Standalone sweep review", { exact: true }),
    })
    .first();
  await expect(standalone).toBeVisible();
  await expect(standalone.getByRole("heading", { name: "Team" })).toBeVisible();
  await expect(standalone.getByRole("link")).toHaveCount(1);
  await expect(
    standalone.getByRole("link", { name: "Link to video", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=EarlierFilm&t=120s",
  );
  await expect(
    page
      .getByRole("region", { name: "Flagged shots", exact: true })
      .getByRole("link", { name: "Link to video", exact: true })
      .and(
        page.locator(
          '[href="https://www.youtube.com/watch?v=abcdefghijk&t=132s"]',
        ),
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Timestamp", { exact: true })).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Team / player", exact: true })
    .selectOption("lead");
  await expect(
    page.getByRole("combobox", { name: "Team / player", exact: true }),
  ).toHaveValue("lead");
  await expect(standalone).toHaveCount(0);
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
