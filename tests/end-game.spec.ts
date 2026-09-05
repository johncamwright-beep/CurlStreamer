import { expect, test, type Route } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

function completedFixture() {
  return {
    status: "completed" as const,
    eventName: "Club final",
    homeName: "Home",
    awayName: "Visitors",
    result: {
      outcome: "home_win",
      label: "Home win",
      totals: { home: 3, away: 2 },
      ends: [],
    },
    youtubeWatchUrl: "https://youtu.be/abcdefghijk",
    completedAt: "2026-09-05T00:00:00Z",
  };
}

test("End Game reviews the score and replaces controls with the saved result", async ({
  page,
}, testInfo) => {
  const game = gameFixture();
  let cleanupRetries = 0;
  await page.route(`**/api/games/${testGameId}`, async (route) => {
    await route.fulfill({
      json: game,
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
      },
    });
  });
  await page.route(`**/api/games/${testGameId}/completion`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { status: "failed", attempts: 1, lastError: "provider timeout" },
      });
      return;
    }
    const body = route.request().postDataJSON();
    if (body.action === "retry-cleanup") {
      cleanupRetries += 1;
      await route.fulfill({
        json: { status: "complete", attempts: 2, lastError: null },
      });
      return;
    }
    if (body.action === "review") {
      expect(body.youtubeWatchUrl).toBe("https://youtu.be/abcdefghijk");
      await route.fulfill({
        json: {
          reviewId: "22222222-2222-4222-8222-222222222222",
          inputRevision: 7,
          result: {
            outcome: "home_win",
            label: "Home win",
            totals: { home: 3, away: 2 },
            ends: [],
          },
          youtubeWatchUrl: body.youtubeWatchUrl,
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        completion: completedFixture(),
        cleanup: {
          status: "failed",
          attempts: 1,
          lastError: "provider timeout",
        },
      },
    });
  });

  await page.goto(`/games/${testGameId}`);
  await page.getByRole("button", { name: "End Game" }).click();
  await expect(
    page.getByText("Visible to viewers on the completed-game page."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Review final score" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "End Game" }).click();
  await page
    .getByLabel("YouTube watch link (optional)")
    .fill("https://youtu.be/abcdefghijk");
  await page.getByRole("button", { name: "Review final score" }).click();
  await expect(page.getByText("Rocks 3 – 2 Stones")).toBeVisible();
  await expect(
    page.getByText("YouTube: https://youtu.be/abcdefghijk"),
  ).toBeVisible();
  await expect(
    page.getByText("This result is final and cannot be edited."),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("score-confirmation.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm End Game" }).click();
  await expect(
    page.getByRole("heading", { name: "Home 3 – 2 Visitors" }),
  ).toBeVisible();
  await expect(page.getByText("Completed Sep 5, 2026")).toBeVisible();
  await expect(
    page.getByText("Live video shutdown has not been confirmed."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", "https://youtu.be/abcdefghijk");
  await expect(page.getByRole("button", { name: "End Game" })).toHaveCount(0);
  await expect(
    page.getByText("LiveKit accepted all room shutdown requests."),
  ).toBeVisible();
  expect(cleanupRetries).toBe(1);
  await page.screenshot({
    path: testInfo.outputPath("completed-summary.png"),
    fullPage: true,
  });
});

test("authorized scoring page reviews and confirms End Game", async ({
  page,
}, testInfo) => {
  const game = gameFixture();
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({
      json: game,
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
      },
    }),
  );
  await page.route(`**/api/games/${testGameId}/completion`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { status: "complete", attempts: 1, lastError: null },
      });
      return;
    }
    const body = route.request().postDataJSON();
    if (body.action === "review") {
      await route.fulfill({
        json: {
          reviewId: "22222222-2222-4222-8222-222222222222",
          inputRevision: 7,
          result: {
            outcome: "home_win",
            label: "Home win",
            totals: { home: 2, away: 0 },
            ends: [],
          },
          youtubeWatchUrl: null,
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        completion: completedFixture(),
        cleanup: { status: "complete", attempts: 1, lastError: null },
      },
    });
  });

  await page.goto(`/score/${testGameId}`);
  await expect(page.getByRole("button", { name: "End Game" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("scoring-end-game-access.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "End Game" }).click();
  await page.getByRole("button", { name: "Review final score" }).click();
  await expect(page.getByText("Rocks 2 – 0 Stones")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("scoring-end-game-confirmation.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm End Game" }).click();
  await expect(
    page.getByRole("heading", { name: "Home 3 – 2 Visitors" }),
  ).toBeVisible();
});

test("scorer-only scoring access cannot End Game", async ({ page }) => {
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({
      json: gameFixture(),
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "scorer",
      },
    }),
  );

  await page.goto(`/score/${testGameId}`);
  await expect(page.getByRole("button", { name: "End Game" })).toHaveCount(0);
  await expect(page.getByText("Game lifecycle")).toHaveCount(0);
});

test("completed Broadcast keeps the result in the fixed program canvas", async ({
  page,
}) => {
  await page.route(`**/api/games/${testGameId}?view=broadcast`, (route) =>
    route.fulfill({ json: completedFixture() }),
  );

  await page.goto(`/broadcast/${testGameId}`);
  await expect(
    page.getByRole("heading", { name: "Home 3 – 2 Visitors" }),
  ).toBeVisible();
  await expect(page.getByTestId("broadcast-fixed-canvas")).toHaveJSProperty(
    "offsetWidth",
    1920,
  );
  await expect(page.getByTestId("broadcast-fixed-canvas")).toHaveJSProperty(
    "offsetHeight",
    1080,
  );
});

for (const [role, managesCleanup] of [
  ["owner", true],
  ["team_admin", true],
  ["scorer", false],
  ["viewer", false],
] as const) {
  test(`completed lobby gives ${role} the correct cleanup controls after reload`, async ({
    page,
  }) => {
    let cleanupRequests = 0;
    await page.route(`**/api/games/${testGameId}`, (route) =>
      route.fulfill({
        json: completedFixture(),
        headers: {
          "x-curlcast-operator": String(role !== "viewer"),
          "x-curlcast-account-role": role,
        },
      }),
    );
    await page.route(`**/api/games/${testGameId}/completion`, (route) => {
      cleanupRequests += 1;
      return route.fulfill({
        json: { status: "failed", attempts: 1, lastError: "provider timeout" },
      });
    });

    await page.goto(`/games/${testGameId}`);
    await expect(
      page.getByRole("heading", { name: "Home 3 – 2 Visitors" }),
    ).toBeVisible();
    if (managesCleanup) {
      await expect(
        page.getByRole("button", { name: "Retry live video shutdown" }),
      ).toBeVisible();
      expect(cleanupRequests).toBeGreaterThan(0);
    } else {
      await expect(
        page.getByRole("button", { name: "Retry live video shutdown" }),
      ).toHaveCount(0);
      expect(cleanupRequests).toBe(0);
    }
  });
}

test("completed lobby preserves organizer cleanup controls after reload", async ({
  page,
}) => {
  const organizer = `header.${Buffer.from(
    JSON.stringify({ purpose: "organizer", gameId: testGameId }),
  ).toString("base64url")}.signature`;
  await page.addInitScript(
    ({ id, token }) => localStorage.setItem(`curlcast-access-${id}`, token),
    { id: testGameId, token: organizer },
  );
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({ json: completedFixture() }),
  );
  await page.route(`**/api/games/${testGameId}/completion`, (route) =>
    route.fulfill({
      json: { status: "failed", attempts: 1, lastError: "provider timeout" },
    }),
  );

  await page.goto(`/games/${testGameId}`);
  await expect(
    page.getByRole("button", { name: "Retry live video shutdown" }),
  ).toBeVisible();
});

test("an authoritative terminal poll stops local camera capture", async ({
  page,
}) => {
  let terminal = false;
  let holdNextActive = false;
  let heldActive: Route | undefined;
  let resolveHeld!: () => void;
  const activeHeld = new Promise<void>((resolve) => (resolveHeld = resolve));
  await page.addInitScript(() => {
    Object.assign(window, { captureStarted: false, captureTrack: undefined });
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0];
    (window as unknown as { captureTrack: MediaStreamTrack }).captureTrack =
      track;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          (window as unknown as { captureStarted: boolean }).captureStarted =
            true;
          return stream;
        },
        enumerateDevices: async () => [],
      },
    });
  });
  await page.route(`**/api/games/${testGameId}`, async (route) => {
    if (holdNextActive) {
      holdNextActive = false;
      heldActive = route;
      resolveHeld();
      return;
    }
    await route.fulfill({
      status: terminal ? 410 : 200,
      json: terminal
        ? { error: "This game is closed", lifecycle: "closed" }
        : gameFixture(),
    });
  });
  await page.route(
    `**/api/games/${testGameId}/livekit-token`,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await route.fulfill({
        status: 503,
        json: { error: "test held request" },
      });
    },
  );

  await page.goto(`/camera/${testGameId}/camera-home`);
  await page.getByRole("button", { name: "Connect Camera" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { captureStarted: boolean }).captureStarted,
      ),
    )
    .toBe(true);
  holdNextActive = true;
  await activeHeld;
  terminal = true;
  await expect(
    page.getByRole("heading", { name: "This game is closed" }),
  ).toBeVisible();
  await heldActive!.fulfill({ status: 200, json: gameFixture() });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { captureTrack: MediaStreamTrack }).captureTrack
            .readyState,
      ),
    )
    .toBe("ended");
  await page.waitForTimeout(1_200);
  await expect(
    page.getByRole("heading", { name: "This game is closed" }),
  ).toBeVisible();
});
