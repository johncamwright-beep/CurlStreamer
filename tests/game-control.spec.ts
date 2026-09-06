import { expect, test, type Page } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

async function fixture(page: Page, role = "owner") {
  const game = gameFixture();
  game.config.homeName = "Northern Ontario Curling Club";
  game.config.awayName = "Team Wright";
  game.config.eventName = "Autumn Bonspiel — Game 3";
  game.cameraHealth!["camera-home"]!.updatedAt = Date.now();
  game.sponsors = [];
  const state = {
    failure: false,
    metadataAvailable: true,
    unreadable: false,
    delayed: false,
    role,
    contextReads: 0,
    polls: 0,
    writes: [] as string[],
  };
  await page.route("**/api/games/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() !== "GET") state.writes.push(url.pathname);
    if (url.pathname === `/api/games/${testGameId}`) {
      if (state.delayed)
        await new Promise((resolve) => setTimeout(resolve, 1500));
      const context =
        request.headers()["x-curlcast-game-context"] === "include";
      if (context) state.contextReads++;
      else state.polls++;
      if (state.failure)
        return route.fulfill({
          status: 503,
          json: { error: "Game service is temporarily unavailable." },
        });
      if (state.unreadable)
        return route.fulfill({
          status: 200,
          body: "not json",
          contentType: "text/plain",
        });
      return route.fulfill({
        json: {
          ...game,
          ...(context
            ? {
                navigationMetadata: state.metadataAvailable
                  ? {
                      state: "available",
                      scheduledStart: "2026-10-20T22:30:00Z",
                      timezone: "America/Toronto",
                      gameNumber: 3,
                    }
                  : { state: "unavailable" },
              }
            : {}),
        },
        headers: {
          "x-curlcast-operator": "true",
          "x-curlcast-account-role": state.role,
        },
      });
    }
    if (url.pathname.endsWith("/broadcast"))
      return route.fulfill({
        json: { status: "idle", desiredState: "stopped" },
      });
    if (url.pathname.endsWith("/invitations"))
      return route.fulfill({
        status: 503,
        json: {
          error: "Invitation response uncertain. Check before retrying.",
        },
      });
    if (url.pathname.endsWith("/livekit-token"))
      return route.fulfill({
        status: 503,
        json: { error: "Isolated fixture: no media service" },
      });
    return route.fulfill({
      status: 403,
      json: { error: "Isolated fixture: action unavailable" },
    });
  });
  return { state, game };
}

test("game control puts daily actions first and fits desktop, 390px and 320px", async ({
  page,
}, info) => {
  const { state } = await fixture(page);
  await page.goto(`/games/${testGameId}`);
  const actions = page.getByRole("navigation", {
    name: "Primary game actions",
  });
  await expect(
    actions.getByRole("link", { name: "Open scoring", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Game schedule")).toContainText(
    "America/Toronto",
  );
  expect((await actions.boundingBox())!.y).toBeLessThan(
    (await page
      .getByText("Invite devices & camera setup", { exact: true })
      .boundingBox())!.y,
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Game 3");
  await expect(
    page.getByText("Reporting video", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Role claimed", { exact: true })).toBeVisible();
  await expect.poll(() => state.polls).toBeGreaterThan(0);
  expect(state.contextReads).toBe(1);
  expect(state.writes).toEqual([]);
  for (const width of [1366, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const undersized = await page
      .locator(".game-control-inner")
      .evaluate((main) =>
        [...main.querySelectorAll("a,button,summary")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.height > 0 && r.height < 44;
          })
          .map((el) => el.textContent),
      );
    expect(undersized).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`game-control-${width}-${info.project.name}.png`),
      fullPage: true,
    });
  }
});

test("current game carries authoritative metadata across control scoring and preview", async ({
  page,
}, info) => {
  await fixture(page);
  for (const path of [
    `/games/${testGameId}`,
    `/score/${testGameId}`,
    `/broadcast/${testGameId}`,
  ]) {
    await page.goto(path);
    if (path.startsWith("/broadcast/"))
      await page.getByRole("button", { name: "Show game details" }).click();
    await expect(page.getByLabel("Game schedule")).toContainText("6:30 PM");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const nav = page.getByRole("navigation", {
      name: "CurlStreamer navigation",
    });
    await expect(nav).toContainText("Game 3");
    await expect(nav).toContainText("America/Toronto");
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("curlcast-current-game")!),
    );
    expect(saved.id).toBe(testGameId);
    expect(saved.scheduledLabel).not.toContain("Saved on this device");
    await page.keyboard.press("Escape");
  }
  const canvas = page.getByTestId("broadcast-fixed-canvas");
  await expect(canvas).toHaveCSS("width", "1920px");
  await expect(canvas).toHaveCSS("height", "1080px");
  await expect(
    canvas.getByRole("complementary", { name: "Preview game context" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath(`preview-context-${info.project.name}.png`),
    fullPage: true,
  });
});

test("camera and scorer roles receive only useful permitted entry links", async ({
  page,
}) => {
  const { state, game } = await fixture(page, "");
  await page.goto(`/games/${testGameId}`);
  await expect(
    page.getByRole("heading", { name: "Device readiness" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary game actions" })
      .getByRole("link", { name: "Open scoring" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Release camera" }),
  ).toHaveCount(0);
  state.role = "scorer";
  game.config.awayName = "Opponent TBD";
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Broadcast preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Assign opponent", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "An organizer must assign the opponent before scoring can begin.",
    ),
  ).toBeVisible();
  state.role = "owner";
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Assign opponent", exact: true }),
  ).toBeVisible();
});

test("loading and failed reads have recovery without replaying invitation writes", async ({
  page,
}, info) => {
  const { state } = await fixture(page);
  state.delayed = true;
  await page.goto(`/games/${testGameId}`);
  await expect(
    page.getByRole("heading", { name: "Loading game control…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to games", exact: true }),
  ).toBeVisible();
  state.delayed = false;
  await expect(
    page.getByRole("heading", { name: "Device readiness" }),
  ).toBeVisible();
  await page
    .getByText("Invite devices & camera setup", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Invitation response uncertain",
  );
  const invitationWrites = state.writes.length;
  expect(invitationWrites).toBe(4);
  state.failure = true;
  await expect(
    page.getByRole("heading", { name: "Game control unavailable" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath(`game-control-error-${info.project.name}.png`),
    fullPage: true,
  });
  state.failure = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Device readiness" }),
  ).toBeVisible();
  expect(state.writes.length).toBe(invitationWrites);
  state.unreadable = true;
  await page.goto(`/broadcast/${testGameId}`);
  await expect(
    page.getByRole("heading", { name: "Broadcast preview unavailable" }),
  ).toBeVisible();
  await expect(page.getByTestId("broadcast-canvas")).toHaveCount(0);
  state.unreadable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("broadcast-canvas")).toBeVisible();
});

test("unavailable schedule preserves clearly labeled same-game device context", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.metadataAvailable = false;
  await page.addInitScript(
    ({ id }) => {
      localStorage.setItem(
        "curlcast-current-game",
        JSON.stringify({
          id,
          title: "Saved match",
          scheduledLabel: "Oct 20, 2026 · 6:30 PM · America/Toronto",
          capabilities: {
            control: true,
            scoring: true,
            broadcast: true,
            editSchedule: true,
            assignOpponent: false,
          },
        }),
      );
    },
    { id: testGameId },
  );
  await page.goto(`/games/${testGameId}`);
  await expect(page.getByLabel("Game schedule")).toContainText(
    "Schedule unavailable",
  );
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(
    page.getByRole("navigation", { name: "CurlStreamer navigation" }),
  ).toContainText("Saved on this device: Oct 20, 2026");
  expect(state.writes).toEqual([]);
});

test("delayed explicit metadata refresh survives a newer state poll without restoring old state", async ({
  page,
}) => {
  const { game } = await fixture(page);
  await page.goto(`/games/${testGameId}`);
  await expect(page.getByLabel("Game schedule")).toContainText("6:30 PM");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  const oldGame = structuredClone(game);
  await page.route(`**/api/games/${testGameId}`, async (route) => {
    if (route.request().headers()["x-curlcast-game-context"] !== "include")
      return route.fallback();
    requested = true;
    await pending;
    await route.fulfill({
      json: {
        ...oldGame,
        navigationMetadata: {
          state: "available",
          scheduledStart: "2026-10-20T23:30:00Z",
          timezone: "America/Toronto",
          gameNumber: 3,
        },
      },
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
      },
    });
  });
  await page.getByRole("button", { name: "Refresh game details" }).click();
  await expect.poll(() => requested).toBe(true);
  game.config.homeName = "Name updated by newer state poll";
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    game.config.homeName,
  );
  release();
  await expect(page.getByLabel("Game schedule")).toContainText("7:30 PM");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    game.config.homeName,
  );
});

test("scoring read retry refreshes unavailable schedule and preview details can be hidden", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.failure = true;
  await page.goto(`/score/${testGameId}`);
  await expect(
    page.getByRole("heading", { name: "Scoring unavailable" }),
  ).toBeVisible();
  state.failure = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Game schedule")).toContainText(
    "America/Toronto",
  );
  await page.goto(`/broadcast/${testGameId}`);
  await expect(page.getByLabel("Game schedule")).toHaveCount(0);
  await page.getByRole("button", { name: "Show game details" }).click();
  await expect(page.getByLabel("Game schedule")).toContainText(
    "America/Toronto",
  );
  await page.getByRole("button", { name: "Hide game details" }).click();
  await expect(page.getByLabel("Game schedule")).toHaveCount(0);
  await expect(page.getByTestId("broadcast-fixed-canvas")).toHaveCSS(
    "width",
    "1920px",
  );
});

test("a hung initial context read does not block ordinary polling or restore stale game state", async ({
  page,
}) => {
  const { game, state } = await fixture(page);
  const initialGame = structuredClone(game);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let contextRequests = 0;
  await page.route(`**/api/games/${testGameId}`, async (route) => {
    if (route.request().headers()["x-curlcast-game-context"] !== "include")
      return route.fallback();
    contextRequests++;
    await pending;
    await route.fulfill({
      json: {
        ...initialGame,
        navigationMetadata: {
          state: "available",
          scheduledStart: "2026-10-20T23:30:00Z",
          timezone: "America/Toronto",
          gameNumber: 3,
        },
      },
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
      },
    });
  });
  try {
    await page.goto(`/games/${testGameId}`);
    await expect.poll(() => contextRequests).toBe(1);
    game.config.homeName = "Latest state from ordinary polling";
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      game.config.homeName,
    );
    await expect(page.getByLabel("Game schedule")).toContainText(
      "Schedule unavailable",
    );
    await expect.poll(() => state.polls).toBeGreaterThanOrEqual(2);
    expect(contextRequests).toBe(1);
    expect(state.writes).toEqual([]);
    release();
    await expect(page.getByLabel("Game schedule")).toContainText("7:30 PM");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      game.config.homeName,
    );
    expect(contextRequests).toBe(1);
    expect(state.writes).toEqual([]);
  } finally {
    release();
  }
});
