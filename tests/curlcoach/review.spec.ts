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
    page.getByText("Screen staying awake", { exact: true }),
  ).toBeVisible();
  const wake = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            wakeTest: { requests: number; releases: number };
          }
        ).wakeTest,
    );
  await page.getByLabel("Keep screen awake", { exact: true }).uncheck();
  await expect
    .poll(async () => {
      const s = await wake();
      return s.requests - s.releases;
    })
    .toBe(0);
  await page.getByLabel("Keep screen awake", { exact: true }).check();
  await expect
    .poll(async () => {
      const s = await wake();
      return s.requests - s.releases;
    })
    .toBe(1);
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: "Miss analysis", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Miss breakdown", exact: true }),
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
    .locator("summary")
    .filter({ hasText: /^Shot review/ })
    .click();
  await page
    .getByRole("combobox", { name: "Review category", exact: true })
    .selectOption("Light");
  await expect(page.locator(".coach-review-item").first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Flagged shots only" }).check();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: "Charting", exact: true }).click();
  await expect(
    page.getByText("Screen staying awake", { exact: true }),
  ).toBeVisible();
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
  await page.goto("/curlcoach");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  const link = () =>
    page.getByRole("link", { name: "Review video from 0:19:15" }).first();
  await expect(link()).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=abcdefghijk&t=1155s",
  );
  for (const name of ["Game analysis", "Miss analysis"]) {
    await page
      .getByRole("button", { name: "Shot Tracker menu", exact: true })
      .click();
    await page.getByRole("link", { name, exact: true }).click();
    await page
      .locator("summary")
      .filter({ hasText: /^Shot review/ })
      .click();
    await page.locator(".coach-review-item > summary").first().click();
    await expect(
      page.getByRole("link", { name: /^Review video/, exact: false }).first(),
    ).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abcdefghijk&t=1155s",
    );
  }
});
