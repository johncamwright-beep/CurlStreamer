import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
test("flagged-shot menu retains filters and exposes review links and editable times", async ({
  page,
}) => {
  await page.route("**/api/curlcoach/workspace?**", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const game of data.event?.games ?? []) {
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
  await page.getByRole("link", { name: "Flagged shots", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Flagged shots", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("all");
  await expect(
    page.getByRole("region", { name: "Flagged shots", exact: true }),
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
