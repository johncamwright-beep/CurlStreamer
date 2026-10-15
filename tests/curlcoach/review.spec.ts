import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
test("miss review scopes season data and screen wake follows scoring", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const state = { requests: 0, releases: 0 };
    Object.assign(window, { wakeTest: state });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          state.requests++;
          const lock = new EventTarget() as EventTarget & {
            released: boolean;
            release: () => Promise<void>;
          };
          lock.released = false;
          lock.release = async () => {
            if (!lock.released) {
              lock.released = true;
              state.releases++;
              lock.dispatchEvent(new Event("release"));
            }
          };
          return lock;
        },
      },
    });
  });
  await page.goto("/curlcoach");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(
    page.getByLabel("Keep screen awake", { exact: true }),
  ).toHaveCount(0);
  const wake = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            wakeTest: { requests: number; releases: number };
          }
        ).wakeTest,
    );
  await expect
    .poll(async () => {
      const s = await wake();
      return s.requests - s.releases;
    })
    .toBe(1);
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Analysis", exact: true })
    .click();
  await page.getByRole("tab", { name: "Miss Analysis", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Recorded reasons", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-metrics")).toHaveCount(0);
  await expect
    .poll(async () => {
      const s = await wake();
      return s.requests - s.releases;
    })
    .toBe(0);
  await expect(
    page.getByRole("combobox", { name: "Event", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("all");
  await page.getByText("More filters", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await page
    .getByRole("region", { name: "Practice priorities", exact: true })
    .getByRole("button", { name: /^Review \d+ shots/ })
    .first()
    .click();
  const reviewed = page.getByRole("region", {
    name: "Review shots",
    exact: true,
  });
  await expect(reviewed).toBeVisible();
  await expect(reviewed.locator("article").first()).toContainText("Draw");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Charting", exact: true })
    .click();
  await expect(
    page.getByLabel("Keep screen awake", { exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      const s = await wake();
      return s.requests - s.releases;
    })
    .toBe(1);
});

test("broadcast flags open the same timed link in scoring, game review and miss analysis", async ({
  page,
}) => {
  await page.route("**/api/curlcoach/workspace?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const game of body.event?.games ?? []) {
      game.broadcastReview = {
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        startedAt: "2026-09-19T12:00:00Z",
        endedAt: "2026-09-19T14:00:00Z",
      };
      for (const entry of game.state.events)
        if (entry.shot) {
          entry.shot.flagged = true;
          entry.shot.flaggedAt = "2026-09-19T12:20:00Z";
          entry.shot.videoReview = {
            url: "",
            positionSeconds: null,
            lookBackSeconds: 45,
          };
        }
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto("/curlcoach?event=shorty-example#charting");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  const link = () =>
    page.getByRole("link", { name: "Review video from 0:19:15" }).first();
  await expect(page.getByLabel("Local lab key")).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Current shot context", exact: true }),
  ).toBeVisible();
  const gameControls = page.getByRole("button", {
    name: "Game controls",
    exact: true,
  });
  const nestedControls = await gameControls.isVisible();
  if (nestedControls) await gameControls.click();
  await page
    .getByRole("button", { name: "Flagged shots", exact: true })
    .click();
  await expect(link()).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=abcdefghijk&t=1155s",
  );
  await page
    .getByRole("button", { name: "Close Flagged shots", exact: true })
    .click();
  if (nestedControls)
    await page
      .getByRole("button", { name: "Close Game controls", exact: true })
      .click();
  for (const name of ["Game analysis", "Miss Analysis"]) {
    await page
      .getByRole("button", { name: "Shot Tracker menu", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("link", {
        name: name === "Miss Analysis" ? "Analysis" : name,
        exact: true,
      })
      .click();
    if (name === "Miss Analysis") {
      await page.getByRole("tab", { name, exact: true }).click();
      await page
        .getByRole("region", { name: "Practice priorities", exact: true })
        .getByRole("button", { name: /^Review \d+ shots/ })
        .first()
        .click();
      await expect(
        page.getByRole("region", { name: "Review shots", exact: true }),
      ).toBeVisible();
    } else {
      await page
        .locator("summary")
        .filter({ hasText: /^Shot review/ })
        .click();
      await page.locator(".coach-review-item > summary").first().click();
    }
    await expect(
      page.getByRole("link", { name: /^Review video/, exact: false }).first(),
    ).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abcdefghijk&t=1155s",
    );
  }
});
