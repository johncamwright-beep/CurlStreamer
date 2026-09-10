import { expect, test, type Page } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

async function setup(page: Page, desktop = false) {
  const game = gameFixture();
  game.cameraHealth!["camera-home"]!.updatedAt = Date.now();
  game.config.homeName = "Northern Ontario Curling Club";
  game.config.awayName = "Team Wright";
  const actions: Record<string, unknown>[] = [];
  await page.route(`**/api/games/${testGameId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const action = route.request().postDataJSON();
      actions.push(action);
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
  await page.route(`**/api/games/${testGameId}/broadcast`, (route) =>
    route.fulfill({ json: { status: "idle", desiredState: "stopped" } }),
  );
  await page.goto(`/score/${testGameId}`);
  await expect(
    desktop
      ? page.getByRole("heading", { level: 1, name: /Northern Ontario/ })
      : page.getByRole("heading", { name: "Scoring", exact: true }),
  ).toBeVisible();
  return { game, actions };
}

test("score entry preserves selected team and points in one saved intent", async ({
  page,
}, info) => {
  const { actions } = await setup(page);
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
    page.getByRole("region", { name: "YouTube broadcast" }),
  ).toContainText("Not started");
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

test("an unreadable broadcast response leaves scoring usable", async ({
  page,
}) => {
  await setup(page);
  await page.route(`**/api/games/${testGameId}/broadcast`, (route) =>
    route.fulfill({ status: 200, body: "not json", contentType: "text/plain" }),
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "YouTube broadcast" }),
  ).toContainText("Status unavailable");
  await expect(
    page.getByRole("button", { name: "Retry status" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Save 1 point" }),
  ).toBeEnabled();
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
      value: "CurlStreamerStudio/0.3 StudioNativeAudio/1",
    }),
  );
  const { game, actions } = await setup(page, true);
  await expect(
    page.getByRole("region", { name: "USB microphones", exact: true }),
  ).toBeVisible();
  await page.evaluate((gameId) => {
    window.dispatchEvent(
      new CustomEvent("studio-usb-status", {
        detail: {
          gameId,
          devices: [],
          running: true,
          error: null,
          channels: [0.1, 0.3, 0.05, 0.2].map((peak) => ({
            peak,
            rms: peak / 2,
            muted: false,
            level: 1,
          })),
        },
      }),
    );
  }, testGameId);
  const usb = page.getByRole("region", {
    name: "USB microphones",
    exact: true,
  });
  await expect(usb.getByRole("meter")).toHaveCount(4);
  await expect(usb.getByRole("button", { name: "Disconnect" })).toBeVisible();
  if (info.project.name !== "mobile") {
    expect((await usb.boundingBox())!.height).toBeLessThan(190);
    const youtube = await page
      .getByRole("region", { name: "YouTube broadcast", exact: true })
      .boundingBox();
    const sponsors = await page
      .getByRole("region", { name: "Sponsors", exact: true })
      .boundingBox();
    expect(sponsors!.height).toBeLessThanOrEqual(166);
    expect(sponsors!.y).toBe(youtube!.y);
    expect(sponsors!.height).toBe(youtube!.height);
  }
  await expect(
    page.getByRole("button", { name: "Save 1 point", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Open navigation menu" }),
  ).toBeVisible();
  await expect(page.getByText("Connect phones", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Camera 1", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/First, use Start recording/)).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "YouTube broadcast" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Cameras", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop sponsors", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Camera 1", exact: true })
      .getByRole("button", { name: "Hide camera", exact: true }),
  ).toBeVisible();
  expect(actions).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Stop sponsors", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("desktop-game-day.png"),
    fullPage: true,
  });
  if (info.project.name !== "mobile") {
    const end = await page
      .getByRole("button", { name: "End Game", exact: true })
      .boundingBox();
    expect(end!.y + end!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    const first = page.getByRole("region", { name: "Camera 1", exact: true });
    const second = page.getByRole("region", { name: "Camera 2", exact: true });
    const scorer = page.getByRole("region", {
      name: "Remote scorer",
      exact: true,
    });
    const before = await first.boundingBox();
    expect((await second.boundingBox())!.y).toBe(before!.y);
    expect((await scorer.boundingBox())!.y).toBe(before!.y);
    expect(before!.y + before!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    await first.getByRole("button", { name: "Show reconnect QR" }).click();
    const qr = first.getByRole("img", { name: "Camera 1 reconnect QR code" });
    await expect(qr).toBeVisible();
    expect((await qr.boundingBox())!.x).toBeGreaterThan(
      before!.x + before!.width,
    );
    expect(await first.boundingBox()).toEqual(before);
    await first.getByRole("button", { name: "Hide QR code" }).click();
  }
  await page.getByRole("button", { name: "Save 1 point", exact: true }).click();
  await expect.poll(() => actions.length).toBe(1);
  expect(actions[0]).toMatchObject({ type: "score", points: 1 });
  await page
    .getByRole("button", { name: "Stop sponsors", exact: true })
    .click();
  expect(actions[1]).toEqual({ type: "sponsor-mode", active: false });
  const sponsors = page.getByRole("region", { name: "Sponsors", exact: true });
  await expect(
    sponsors.getByRole("button", { name: /^(Previous|Pause|Resume|Next)$/ }),
  ).toHaveCount(0);
  await sponsors
    .getByRole("button", { name: "Side panel", exact: true })
    .click();
  expect(actions[2]).toEqual({
    type: "sponsor-mode",
    active: false,
    style: "fullscreen",
  });
  await page.reload();
  await expect(
    sponsors.getByRole("button", { name: "Side panel", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await sponsors.getByRole("button", { name: "Overlay", exact: true }).click();
  expect(actions[3]).toEqual({
    type: "sponsor-mode",
    active: false,
    style: "overlay",
  });
  const camera1 = page.getByRole("region", { name: "Camera 1", exact: true });
  const camera2 = page.getByRole("region", { name: "Camera 2", exact: true });
  await camera1
    .getByRole("button", { name: "Hide camera", exact: true })
    .click();
  await expect(
    camera1.getByRole("button", { name: "Show camera", exact: true }),
  ).toBeVisible();
  await camera2
    .getByRole("button", { name: "Hide camera", exact: true })
    .click();
  await expect(
    camera2.getByRole("button", { name: "Show camera", exact: true }),
  ).toBeVisible();
  await camera1
    .getByRole("button", { name: "Show camera", exact: true })
    .click();
  await camera2
    .getByRole("button", { name: "Show camera", exact: true })
    .click();
  expect(actions.slice(4)).toEqual(
    ["away", "none", "home", "split"].map((layout) => ({
      type: "layout",
      layout,
    })),
  );
  expect(game.claims).toEqual(gameFixture().claims);
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
