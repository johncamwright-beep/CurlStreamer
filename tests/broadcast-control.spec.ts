import { expect, test, type Page, type Route } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

type BroadcastState = {
  desiredState: "live" | "stopped";
  status: "idle" | "preparing" | "live" | "failed" | "stopped";
  lastErrorCode?: string;
  watchUrl?: string;
};

async function mockScoringPage(page: Page) {
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({
      json: gameFixture(),
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
      },
    }),
  );
}

async function actionFrom(route: Route) {
  return (await route.request().postDataJSON()) as {
    action: "start" | "stop";
  };
}

test("an owner starts a broadcast from idle and stops the live stream", async ({
  page,
}, testInfo) => {
  await mockScoringPage(page);
  let state: BroadcastState = { desiredState: "stopped", status: "idle" };
  const actions: string[] = [];
  await page.route(`**/api/games/${testGameId}/broadcast`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: state });
      return;
    }
    const { action } = await actionFrom(route);
    actions.push(action);
    state =
      action === "start"
        ? {
            desiredState: "live",
            status: "live",
            watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
          }
        : { desiredState: "stopped", status: "stopped" };
    await route.fulfill({ json: state });
  });

  await page.goto(`/score/${testGameId}`);
  await page.getByRole("button", { name: "Start broadcast" }).click();
  await expect(
    page.getByText(
      "Video is being sent to the connected team YouTube channel.",
    ),
  ).toBeVisible();
  const youtubeLink = page.getByRole("link", {
    name: "Watch on YouTube",
  });
  await expect(youtubeLink).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=abcdefghijk",
  );
  expect(
    await youtubeLink.evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
  ).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: testInfo.outputPath(`youtube-panel-${testInfo.project.name}.png`),
    fullPage: true,
  });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "End broadcast" }).click();
  await expect(
    page.getByRole("button", { name: "Broadcast ended" }),
  ).toBeDisabled();
  expect(actions).toEqual(["start", "stop"]);
});

test("an owner stops preparation and retries a failed Stop", async ({
  page,
}) => {
  await mockScoringPage(page);
  let state: BroadcastState = { desiredState: "stopped", status: "idle" };
  let stopAttempts = 0;
  await page.route(`**/api/games/${testGameId}/broadcast`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: state });
      return;
    }
    const { action } = await actionFrom(route);
    if (action === "start") {
      state = { desiredState: "live", status: "preparing" };
    } else if (++stopAttempts === 1) {
      state = {
        desiredState: "stopped",
        status: "failed",
        lastErrorCode: "broadcast_operation_uncertain",
      };
    } else {
      state = { desiredState: "stopped", status: "stopped" };
    }
    await route.fulfill({ json: state });
  });

  await page.goto(`/score/${testGameId}`);
  await page.getByRole("button", { name: "Start broadcast" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel broadcast setup" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel broadcast setup" }).click();
  await expect(
    page.getByText("The last attempt did not finish cleanly.", {
      exact: false,
    }),
  ).toBeVisible();
  const youtubePanel = page.getByRole("region", {
    name: "YouTube broadcast",
  });
  await expect(youtubePanel.getByRole("button")).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Retry stop" }).click();
  await expect(
    page.getByRole("button", { name: "Broadcast ended" }),
  ).toBeDisabled();
  expect(stopAttempts).toBe(2);
});

test("eligibility guidance remains usable at 320px", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "One 320px visual is sufficient",
  );
  await page.setViewportSize({ width: 320, height: 800 });
  await mockScoringPage(page);
  await page.route(`**/api/games/${testGameId}/broadcast`, (route) =>
    route.fulfill({
      json: {
        desiredState: "live",
        status: "failed",
        lastErrorCode: "youtube_live_streaming_not_enabled",
      },
    }),
  );

  await page.goto(`/score/${testGameId}`);
  await expect(page.getByText("Needs attention")).toBeVisible();
  await expect(
    page.getByText("up to 24 hours", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review YouTube feature eligibility" }),
  ).toHaveAttribute("href", "https://www.youtube.com/features");
  await expect(
    page.getByRole("button", { name: "Retry broadcast" }),
  ).toHaveCount(1);
  await expect(page.getByText("MICROPHONES LIVE")).toHaveCount(0);
  await expect(page.getByText("Demo audio controls")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mute demo audio" }),
  ).not.toHaveAttribute("aria-pressed");
  await page.screenshot({
    path: testInfo.outputPath("youtube-panel-320px.png"),
    fullPage: true,
  });
});

test("a failed live poll removes the verified Live claim until retry", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "Covered once as a state recovery flow",
  );
  await page.clock.install();
  await mockScoringPage(page);
  let reads = 0;
  await page.route(`**/api/games/${testGameId}/broadcast`, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        json: { error: "The stop response was not confirmed." },
      });
      return;
    }
    reads += 1;
    if (reads === 2) {
      await route.fulfill({
        status: 503,
        json: { error: "Broadcast status could not be refreshed." },
      });
      return;
    }
    await route.fulfill({
      json: {
        desiredState: "live",
        status: "live",
        watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      },
    });
  });

  await page.goto(`/score/${testGameId}`);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page.clock.fastForward(15_000);
  await expect(page.getByText("Status unavailable")).toBeVisible();
  await expect(
    page.getByText("Last confirmed live", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "End broadcast" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Retry status" }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  expect(reads).toBe(3);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "End broadcast" }).click();
  await expect(page.getByText("Status unavailable")).toBeVisible();
  await expect(
    page.getByText("Could not confirm broadcast status."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry status" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "End broadcast" }),
  ).toBeEnabled();
});
