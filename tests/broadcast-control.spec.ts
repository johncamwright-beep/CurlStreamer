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
}) => {
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
  await page.getByRole("button", { name: "Start Broadcast" }).click();
  await expect(
    page.getByText("Live on the saved team YouTube channel."),
  ).toBeVisible();
  const youtubeLink = page.getByRole("link", {
    name: "Open YouTube broadcast",
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

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Stop Broadcast" }).click();
  await expect(
    page.getByRole("button", { name: "Broadcast stopped" }),
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
  await page.getByRole("button", { name: "Start Broadcast" }).click();
  await expect(
    page.getByRole("button", { name: "Stop preparation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop preparation" }).click();
  await expect(
    page.getByText("Broadcast failed.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry Stop" }).click();
  await expect(
    page.getByRole("button", { name: "Broadcast stopped" }),
  ).toBeDisabled();
  expect(stopAttempts).toBe(2);
});
