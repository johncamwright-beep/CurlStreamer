import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
test("miss review scopes season data and screen wake follows scoring", async ({
  page,
}) => {
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
  await expect(
    page
      .getByRole("region", { name: "Miss review shots" })
      .locator("article")
      .first(),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await page
    .getByRole("combobox", { name: "Reason", exact: true })
    .selectOption("Light");
  const cards = page
    .getByRole("region", { name: "Miss review shots" })
    .locator("article");
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) {
    await expect(card.locator("h4")).toContainText("Draw");
    await expect(card).toContainText("Light");
  }
  await page
    .getByRole("combobox", { name: "Reason", exact: true })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "Review", exact: true })
    .selectOption("flags");
  for (const card of await cards.all())
    await expect(card).toContainText("Flagged for review");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: "Scoring", exact: true }).click();
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
