import { expect, test, type Page } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";
import { applyScoringAction } from "../src/lib/scoring";

async function setup(page: Page, desktop = false) {
  await page.route(
    `**/api/games/${testGameId}/camera-reconnect-invitation`,
    (route) =>
      route.fulfill({
        json: {
          url: new URL(
            `/studio-m2/${testGameId}/camera/${route.request().postDataJSON().role}#token=fixture-renewal`,
            route.request().url(),
          ).href,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      }),
  );
  const game = gameFixture();
  game.cameraHealth!["camera-home"]!.updatedAt = Date.now();
  game.config.homeName = "Northern Ontario Curling Club";
  game.config.awayName = "Team Wright";
  const actions: Record<string, unknown>[] = [];
  let legacyBroadcastRequests = 0;
  await page.route(`**/api/games/${testGameId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const action = route.request().postDataJSON();
      actions.push(action);
      if (["score", "hammer", "undo"].includes(action.type))
        applyScoringAction(game, action);
      if (action.type === "layout") game.layout = action.layout;
      if (action.type === "sponsor-mode") {
        game.sponsorMode.active = action.active;
        if (action.style) game.sponsorMode.style = action.style;
      }
    }
    await route.fulfill({
      json: game,
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
        "x-curlcast-m1-pilot": "true",
      },
    });
  });
  await page.route(`**/api/games/${testGameId}/broadcast`, (route) => {
    legacyBroadcastRequests += 1;
    return route.fulfill({ json: { status: "idle", desiredState: "stopped" } });
  });
  await page.route(`**/api/games/${testGameId}/studio-m4`, (route) =>
    route.fulfill({
      json: {
        status: "prepared",
        watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      },
    }),
  );
  await page.goto(`/score/${testGameId}`);
  await expect(
    desktop
      ? page.getByRole("heading", { level: 1, name: /Northern Ontario/ })
      : page.getByRole("heading", { name: "Scoring", exact: true }),
  ).toBeVisible();
  return {
    game,
    actions,
    legacyBroadcastRequests: () => legacyBroadcastRequests,
  };
}

test("starting hammer is selected inside the scoreboard without a separate card", async ({
  page,
}) => {
  const { game, actions } = await setup(page);
  game.config.initialHammer = undefined;
  game.scoreEvents = [];
  await page.reload();
  const scoreboard = page.getByRole("region", {
    name: "Match score",
    exact: true,
  });
  const hammer = scoreboard.getByRole("button", {
    name: "Give Team Wright hammer in End 1",
    exact: true,
  });
  await expect(hammer).toBeVisible();
  await expect(
    page.getByText("Who has hammer in End 1?", { exact: true }),
  ).toHaveCount(0);
  expect((await hammer.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await hammer.click();
  await expect.poll(() => actions.length).toBe(1);
  expect(actions[0]).toMatchObject({
    type: "hammer",
    team: "away",
    expectedEnd: 1,
  });
  await expect(hammer).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Record End 1" }),
  ).toBeVisible();
});

test("score entry preserves selected team and points in one saved intent", async ({
  page,
}, info) => {
  const { actions, game } = await setup(page);
  const originalEvents = structuredClone(game.scoreEvents);
  await expect(page.getByRole("region", { name: "Match score" })).toContainText(
    "Northern Ontario Curling Club",
  );
  await page
    .getByRole("group", { name: "Scoring team" })
    .getByRole("button", { name: "Team Wright" })
    .click();
  await page
    .getByRole("group", { name: "Points scored" })
    .getByRole("button", { name: "3 points", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Points scored" })
      .getByRole("button", { name: "3 points", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Save 3 points" }).click();
  await expect(page.getByRole("status", { name: "Scoring update" })).toHaveText(
    "End 2 saved.",
  );
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    type: "score",
    team: "away",
    points: 3,
    expectedEnd: 2,
    blank: false,
  });
  expect(game.scoreEvents.slice(0, -1)).toEqual(originalEvents);
  expect(game.scoreEvents.at(-1)).toMatchObject({
    id: actions[0].intentId,
    type: "end",
    expectedLastEventId: originalEvents.at(-1)?.id,
    score: { end: 2, team: "away", points: 3, blank: false },
  });
  await expect(
    page.getByRole("heading", { name: "Record End 3" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Match score" })).toContainText(
    "End 3",
  );
  await expect(
    page.getByRole("region", { name: "Match score" }).locator(".scoring-total"),
  ).toHaveText(["2", "3"]);
  await expect(
    page.getByRole("button", { name: "Save 3 points" }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath(`scoring-workspace-${info.project.name}.png`),
    fullPage: true,
  });
});

test("camera and demo audio status stay separate from YouTube status", async ({
  page,
}) => {
  await setup(page);
  const cameras = page.getByRole("region", { name: "Cameras", exact: true });
  await expect(cameras).toContainText("Connected");
  await expect(cameras).toContainText("Offline");
  const audio = page.getByRole("region", { name: "Audio", exact: true });
  await expect(audio).toContainText("Demo audio muted");
  await expect(audio).toContainText(
    "Sponsor overlay is keeping demo audio muted.",
  );
  await expect(
    page.getByRole("heading", { name: "Requires Windows Studio" }),
  ).toBeVisible();
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "temporary_failure" } })
      : route.fulfill({
          json: gameFixture(),
          headers: {
            "x-curlcast-account-role": "owner",
            "x-curlcast-operator": "true",
          },
        }),
  );
  await cameras.getByRole("button", { name: "Camera 2", exact: true }).click();
  await expect(
    page.getByRole("alert", { name: "Program control error" }),
  ).toContainText("could not be updated");
  await expect(
    cameras.getByRole("button", { name: "Camera 2", exact: true }),
  ).toBeEnabled();
});

test("narrow scoring keeps end history scrollable and controls at least 44px", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await setup(page);
  await page.getByText("End-by-end score", { exact: true }).click();
  const history = page.getByRole("region", {
    name: "Score by end, scroll for more ends",
  });
  await expect(history).toHaveAttribute("tabindex", "0");
  const sizes = await page.locator(".scoring-workspace").evaluate((main) => ({
    width: main.getBoundingClientRect().width,
    viewport: innerWidth,
    oversized: [...main.querySelectorAll("button,a,select,summary")]
      .filter(
        (el) =>
          el.getBoundingClientRect().height > 0 &&
          el.getBoundingClientRect().height < 44,
      )
      .map((el) => el.textContent),
    pageWidth: document.documentElement.scrollWidth,
  }));
  expect(sizes.width).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.pageWidth).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.oversized).toEqual([]);
  const clippedCards = await page
    .locator(".scoring-card")
    .evaluateAll((cards) =>
      cards
        .filter((card) => card.getBoundingClientRect().right > innerWidth)
        .map((card) => card.querySelector("h2")?.textContent),
    );
  expect(clippedCards).toEqual([]);
  await page.screenshot({
    path: info.outputPath(`scoring-narrow-${info.project.name}.png`),
    fullPage: true,
  });
});

test("an unavailable scoring page retains navigation and recovery", async ({
  page,
}) => {
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Game service is temporarily unavailable." },
    }),
  );
  await page.goto(`/score/${testGameId}`);
  await expect(
    page.getByRole("heading", { name: "Scoring unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to games" }),
  ).toHaveAttribute("href", "/dashboard");
  await expect(page.getByRole("button", { name: "Save 1 point" })).toHaveCount(
    0,
  );
});

test("browser scoring keeps stream start in Windows Studio", async ({
  page,
}) => {
  const { legacyBroadcastRequests } = await setup(page);
  await expect(
    page.getByRole("heading", { name: "Requires Windows Studio" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download Studio", exact: true }),
  ).toHaveAttribute("href", "/download");
  await expect(
    page.getByRole("button", { name: "Start broadcast" }),
  ).toHaveCount(0);
  expect(legacyBroadcastRequests()).toBe(0);
  await expect(
    page.getByRole("button", { name: "Save 1 point" }),
  ).toBeEnabled();
});

test("scoring preserves its last loaded controls during a transient outage and clears them on revocation", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("group", { name: "Points scored" })
    .getByRole("button", { name: "3 points", exact: true })
    .click();
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Showing the last loaded score" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save 3 points" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scoring unavailable" }),
  ).toHaveCount(0);
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({
      json: gameFixture(),
      headers: { "x-curlcast-account-role": "owner" },
    }),
  );
  await expect(page.getByText(/Showing the last loaded score/)).toHaveCount(0, {
    timeout: 15000,
  });
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({ status: 403, json: { error: "Access revoked" } }),
  );
  await expect(
    page.getByRole("heading", { name: "Scoring unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save 3 points" })).toHaveCount(
    0,
  );
});

test("an active carousel can be stopped after its sponsors are removed", async ({
  page,
}) => {
  const { game, actions } = await setup(page);
  game.sponsors = [];
  await page.reload();
  await page.getByRole("button", { name: "Stop sponsors" }).click();
  expect(actions).toEqual([{ type: "sponsor-mode", active: false }]);
});

test("desktop game day keeps scoring primary and settings available on demand", async ({
  page,
}, info) => {
  if (info.project.name !== "mobile")
    await page.setViewportSize({ width: 1280, height: 850 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", {
      value:
        "CurlStreamerStudio/0.3 StudioNativeAudio/1 StudioProgramPreview/1",
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "chrome", {
      configurable: true,
      value: { webview: { postMessage() {} } },
    });
  });
  await page.route("**/__studio-preview/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#163343"/><text x="600" y="540" fill="white" font-size="64">Test program frame</text></svg>',
    }),
  );
  const { game, actions } = await setup(page, true);
  await page.evaluate((gameId) => {
    window.dispatchEvent(
      new CustomEvent("studio-youtube-status", {
        detail: {
          gameId,
          available: true,
          busy: false,
          streaming: "armed",
          live: true,
          receiving: true,
          message: "",
          canReconnect: true,
          outputActive: true,
        },
      }),
    );
  }, testGameId);
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toBeVisible();
  const preview = page.getByRole("region", {
    name: "Studio program preview",
    exact: true,
  });
  await expect(
    preview.getByRole("img", { name: "Actual Studio program output" }),
  ).toBeVisible();
  await page.evaluate(
    (gameId) =>
      window.dispatchEvent(
        new CustomEvent("studio-session-status", {
          detail: {
            gameId,
            title: "Test game",
            active: true,
            busy: false,
            presentation: "live",
            streaming: "armed",
            outputActive: true,
            live: true,
            canHoldStream: true,
          },
        }),
      ),
    testGameId,
  );
  await expect(page.locator(".studio-preview-status")).toHaveText("LIVE");
  const position = () =>
    preview.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    });
  const before = await position();
  await page
    .getByRole("region", { name: "Camera 1", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const phoneSettings = page.getByRole("dialog", {
    name: "Camera 1 settings",
    exact: true,
  });
  await phoneSettings
    .getByRole("button", { name: "Show reconnect QR", exact: true })
    .click();
  const qrDialog = page.getByRole("dialog", {
    name: "Camera 1 QR code",
    exact: true,
  });
  await expect(
    qrDialog.getByRole("img", { name: "Camera 1 reconnect QR code" }),
  ).toBeVisible();
  await qrDialog.getByRole("button", { name: "Close", exact: true }).click();
  await phoneSettings
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect(await position()).toEqual(before);

  await page
    .getByRole("button", { name: "Camera Settings", exact: true })
    .click();
  const cameraSettings = page.getByRole("dialog", {
    name: "Camera Settings",
    exact: true,
  });
  await expect(
    cameraSettings.getByRole("button", { name: "Camera 1 zoom in" }),
  ).toBeVisible();
  await expect(
    cameraSettings.getByLabel("Microphone sync adjustment"),
  ).toHaveValue("-1500");
  await cameraSettings
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect(await position()).toEqual(before);
  await page.getByRole("button", { name: "Sponsors", exact: true }).click();
  const sponsorsDialog = page.getByRole("dialog", {
    name: "Sponsors",
    exact: true,
  });
  await sponsorsDialog
    .getByRole("button", { name: "Stop sponsors", exact: true })
    .click();
  expect(actions[0]).toEqual({ type: "sponsor-mode", active: false });
  await sponsorsDialog
    .getByRole("button", { name: "Side panel", exact: true })
    .click();
  expect(actions[1]).toEqual({
    type: "sponsor-mode",
    active: false,
    style: "fullscreen",
  });
  await sponsorsDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect(await position()).toEqual(before);
  const usb = page.getByRole("region", {
    name: "USB microphones",
    exact: true,
  });
  await expect(usb.getByRole("meter")).toHaveCount(4);
  await usb.getByRole("button", { name: "USB setup", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "USB setup", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "USB setup", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect(await position()).toEqual(before);
  await page.evaluate(
    (gameId) =>
      window.dispatchEvent(
        new CustomEvent("studio-youtube-status", {
          detail: {
            gameId,
            available: true,
            busy: false,
            streaming: "armed",
            live: false,
            receiving: true,
            outputActive: true,
            canReconnect: true,
            message: "YouTube status delayed test message",
          },
        }),
      ),
    testGameId,
  );
  await page.getByRole("button", { name: "Status Log", exact: true }).click();
  const log = page.getByRole("dialog", { name: "Status Log", exact: true });
  await expect(log).toContainText("YouTube status delayed test message");
  await log.getByRole("button", { name: "Close", exact: true }).click();
  expect(await position()).toEqual(before);
  await expect(
    page.getByRole("region", { name: "Score by end, scroll for more ends" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (info.project.name !== "mobile") {
    const scoreBox = (await page
      .getByRole("region", { name: "Match score" })
      .boundingBox())!;
    const previewBox = (await preview.boundingBox())!;
    expect(previewBox.x).toBeGreaterThan(scoreBox.x + scoreBox.width);
    const first = (await page
      .getByRole("region", { name: "Camera 1", exact: true })
      .boundingBox())!;
    const second = (await page
      .getByRole("region", { name: "Camera 2", exact: true })
      .boundingBox())!;
    const remote = (await page
      .getByRole("region", { name: "Remote scorer", exact: true })
      .boundingBox())!;
    expect(second.y).toBe(first.y);
    expect(remote.y).toBeGreaterThan(first.y);
  }
  await page.screenshot({
    path: info.outputPath("desktop-game-day.png"),
    fullPage: true,
  });
  if (info.project.name !== "mobile") {
    await page.setViewportSize({ width: 1680, height: 960 });
    await page.screenshot({
      path: info.outputPath("studio-cockpit-1680.png"),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Save 1 point", exact: true }).click();
  await expect.poll(() => actions.length).toBe(3);
  expect(actions[2]).toMatchObject({ type: "score", points: 1 });
  expect(game.claims).toEqual(gameFixture().claims);
});

test("Studio preview keeps its last picture through failed frame requests", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", {
      value: "CurlStreamerStudio/0.3 StudioProgramPreview/1",
    }),
  );
  let unavailable = false;
  const frame =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#163343"/></svg>';
  await page.route("**/__studio-preview/**", (route) =>
    unavailable
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({ contentType: "image/svg+xml", body: frame }),
  );
  await setup(page, true);
  const preview = page.getByRole("region", {
    name: "Studio program preview",
    exact: true,
  });
  await expect(
    preview.getByRole("img", { name: "Actual Studio program output" }),
  ).toBeVisible();
  unavailable = true;
  await expect(preview.getByText("Preview reconnecting…")).toBeVisible({
    timeout: 10000,
  });
  await expect(
    preview.getByRole("img", { name: "Actual Studio program output" }),
  ).toBeVisible();
  await expect(preview.getByText("Waiting for Studio’s picture")).toHaveCount(
    0,
  );
  unavailable = false;
  await expect(preview.getByText("Preview reconnecting…")).toHaveCount(0);
});

test("remote scorer only sees scoreboard controls", async ({ page }) => {
  const game = gameFixture();
  await page.route("**/api/games/" + testGameId, (route) =>
    route.fulfill({
      json: game,
      headers: {
        "x-curlcast-operator": "false",
        "x-curlcast-account-role": "scorer",
      },
    }),
  );
  await page.goto("/score/" + testGameId);
  await expect(
    page.getByRole("button", { name: "Save 1 point", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Broadcast and program controls" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Broadcast controls ↓", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "End Game", exact: true }),
  ).toHaveCount(0);
});

test("Studio inline zoom sends camera commands without changing the score", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", {
      value: "CurlStreamerStudio/0.3",
    }),
  );
  const { game, actions } = await setup(page, true);
  game.cameraZoom = {
    "camera-home": {
      supported: true,
      min: 1,
      max: 4,
      step: 0.1,
      value: 1,
      updatedAt: Date.now(),
    },
  };
  await page.reload();
  await page
    .getByRole("button", { name: "Camera Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Camera 1 zoom in", exact: true })
    .click();
  await expect.poll(() => actions.length).toBe(1);
  expect(actions[0]).toMatchObject({
    type: "camera-zoom",
    role: "camera-home",
    value: 1.1,
  });
  expect(actions[0].commandId).toEqual(expect.any(String));
  await expect(
    page.getByRole("button", { name: "Save 1 point", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Camera 2 zoom in", exact: true }),
  ).toBeDisabled();
});
