import { expect, test, type Page } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";
import type { StudioSession } from "../src/lib/studio-session";

type NativeMessage = {
  type: string;
  gameId?: string;
  nonce?: string;
  decision?: string;
};
type FixtureWindow = Window & {
  studioFixture: { session: StudioSession; messages: NativeMessage[] };
};
const otherGameId = "22222222-2222-4222-8222-222222222222";
const requestNonce = "33333333-3333-4333-8333-333333333333";
const wrongNonce = "44444444-4444-4444-8444-444444444444";
const liveSession: StudioSession = {
  gameId: testGameId,
  title: "Rocks vs Stones · Club final",
  active: true,
  busy: false,
  presentation: "live",
  streaming: "armed",
  outputActive: true,
  live: true,
  canHoldStream: true,
};

async function setup(page: Page, session = liveSession, bridge = true) {
  await page.addInitScript(
    ({ session, bridge }) => {
      const saved = sessionStorage.getItem("studio-fixture-after-reload");
      const fixture = {
        session: saved ? (JSON.parse(saved) as StudioSession) : session,
        messages: [] as NativeMessage[],
      };
      (window as unknown as FixtureWindow).studioFixture = fixture;
      if (!bridge) return;
      Object.defineProperty(navigator, "userAgent", {
        value: "CurlStreamerStudio/0.3 StudioProgramPreview/1",
      });
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          webview: {
            postMessage(message: NativeMessage) {
              fixture.messages.push(message);
              if (message.type === "studio-session-observe")
                window.dispatchEvent(
                  new CustomEvent("studio-session-status", {
                    detail: fixture.session,
                  }),
                );
            },
          },
        },
      });
    },
    { session, bridge },
  );
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({
      json: gameFixture(),
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
        "x-curlcast-m1-pilot": "true",
      },
    }),
  );
  await page.route(`**/api/games/${testGameId}/studio-m4`, (route) =>
    route.fulfill({ json: { status: "prepared" } }),
  );
  await page.route("**/__studio-preview/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#163343"/></svg>',
    }),
  );
  await page.goto(`/score/${testGameId}`);
  await expect(
    page.getByRole("button", { name: "Save 1 point", exact: true }),
  ).toBeVisible();
  if (bridge)
    await expect
      .poll(async () => (await messages(page, "studio-session-observe")).length)
      .toBeGreaterThan(0);
}

async function messages(page: Page, type: string) {
  return page.evaluate(
    (type) =>
      (window as unknown as FixtureWindow).studioFixture.messages.filter(
        (message) => message.type === type,
      ),
    type,
  );
}

async function status(page: Page, update: Partial<StudioSession>) {
  await page.evaluate((update) => {
    const fixture = (window as unknown as FixtureWindow).studioFixture;
    fixture.session = { ...fixture.session, ...update };
    sessionStorage.setItem(
      "studio-fixture-after-reload",
      JSON.stringify(fixture.session),
    );
    window.dispatchEvent(
      new CustomEvent("studio-session-status", { detail: fixture.session }),
    );
  }, update);
}

// Use a local anchor to exercise the root capture listener independently of
// account authentication and menu rendering on the fixture server.
async function destination(page: Page, href = "/download", target = "") {
  await page.evaluate(
    ({ href, target }) => {
      document.getElementById("fixture-navigation")?.remove();
      const anchor = document.createElement("a");
      anchor.id = "fixture-navigation";
      anchor.textContent = "Fixture navigation destination";
      anchor.href = href;
      anchor.target = target;
      anchor.style.cssText = "display:block;min-height:44px;padding:12px";
      document.querySelector("main")!.prepend(anchor);
    },
    { href, target },
  );
  return page.getByRole("link", { name: "Fixture navigation destination" });
}

function dialog(page: Page) {
  return page.getByRole("dialog", { name: "Leave the game screen?" });
}

async function presentationReceipt(
  page: Page,
  message: NativeMessage,
  overrides: Record<string, unknown> = {},
) {
  await page.evaluate(
    ({ message, overrides }) => {
      window.dispatchEvent(
        new CustomEvent("studio-presentation-result", {
          detail: {
            gameId: message.gameId,
            nonce: message.nonce,
            ok: true,
            presentation: { generation: 1, mode: "hold" },
            ...overrides,
          },
        }),
      );
    },
    { message, overrides },
  );
}

test("continue leaves the game while its live Studio status remains available", async ({
  page,
}, info) => {
  await setup(page);
  await expect
    .poll(async () => (await messages(page, "studio-game-ready")).length)
    .toBeGreaterThan(0);
  for (const ready of await messages(page, "studio-game-ready"))
    expect(ready).toEqual({ type: "studio-game-ready", gameId: testGameId });
  await expect
    .poll(async () => (await messages(page, "studio-session-title")).length)
    .toBeGreaterThan(0);
  for (const title of await messages(page, "studio-session-title"))
    expect(title).toEqual({
      type: "studio-session-title",
      gameId: testGameId,
      title: "Rocks vs Stones — Club final",
    });
  await (await destination(page)).click();
  const leave = dialog(page);
  await expect(leave).toBeVisible();
  await expect(
    leave.getByRole("button", { name: "Continue broadcast" }),
  ).toBeFocused();
  for (const button of await leave.getByRole("button").all())
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(`studio-leave-${info.project.name}.png`),
    fullPage: true,
  });
  await leave.getByRole("button", { name: "Continue broadcast" }).click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(leave).toHaveCount(0);
  const banner = page.getByRole("complementary", {
    name: "Active Studio game",
  });
  await expect(banner).toContainText(liveSession.title);
  await expect(banner.getByRole("status")).toHaveText("Broadcast live");
  await expect(
    banner.getByRole("link", { name: "Return to game" }),
  ).toHaveAttribute("href", `/score/${testGameId}`);
  expect(await messages(page, "studio-youtube-hold")).toEqual([]);
  expect(await messages(page, "studio-youtube-stop")).toEqual([]);
  await banner.getByRole("link", { name: "Return to game" }).click();
  await expect(page).toHaveURL(`/score/${testGameId}`);
  await expect(banner).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
});

test("pause waits for the matching game and nonce and a confirmed hold before leaving", async ({
  page,
}) => {
  await setup(page);
  await (await destination(page)).click();
  await dialog(page).getByRole("button", { name: "Pause broadcast" }).click();
  await expect
    .poll(async () => (await messages(page, "studio-youtube-hold")).length)
    .toBe(1);
  const [request] = await messages(page, "studio-youtube-hold");
  expect(request.gameId).toBe(testGameId);
  expect(request.nonce).toMatch(/^[\da-f-]{36}$/i);
  await presentationReceipt(page, request, { nonce: wrongNonce });
  await presentationReceipt(page, request, { gameId: otherGameId });
  // A status update alone is not the correlated presentation receipt.
  await status(page, { presentation: "hold" });
  await expect(dialog(page).getByRole("status")).toHaveText(
    "Confirming your choice…",
  );
  await expect(page).toHaveURL(`/score/${testGameId}`);
  await presentationReceipt(page, request);
  await expect(page).toHaveURL(/\/download$/);
  await expect(
    page
      .getByRole("complementary", { name: "Active Studio game" })
      .getByRole("status"),
  ).toHaveText("Broadcast paused");
  expect(await messages(page, "studio-youtube-stop")).toEqual([]);
});

test("failed pause keeps the route and dialog, and Stay here restores navigation focus", async ({
  page,
}) => {
  await setup(page);
  const link = await destination(page);
  await link.click();
  await dialog(page).getByRole("button", { name: "Pause broadcast" }).click();
  await expect
    .poll(async () => (await messages(page, "studio-youtube-hold")).length)
    .toBe(1);
  await presentationReceipt(
    page,
    (await messages(page, "studio-youtube-hold"))[0],
    {
      ok: false,
      error: "Test Studio could not pause its output.",
    },
  );
  await expect(dialog(page).getByRole("alert")).toHaveText(
    "Test Studio could not pause its output.",
  );
  await expect(page).toHaveURL(`/score/${testGameId}`);
  await dialog(page).getByRole("button", { name: "Stay here" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(link).toBeFocused();
  expect(await messages(page, "studio-youtube-stop")).toEqual([]);
});

test("a successful receipt with the wrong presentation retains the game", async ({
  page,
}) => {
  await setup(page);
  await (await destination(page)).click();
  await dialog(page).getByRole("button", { name: "Pause broadcast" }).click();
  await expect
    .poll(async () => (await messages(page, "studio-youtube-hold")).length)
    .toBe(1);
  await presentationReceipt(
    page,
    (await messages(page, "studio-youtube-hold"))[0],
    {
      presentation: { generation: 1, mode: "live" },
    },
  );
  await expect(dialog(page).getByRole("alert")).toContainText(
    "did not confirm the pause card",
  );
  await expect(page).toHaveURL(`/score/${testGameId}`);
});

test("settings navigation retains paused status and resume requires a matching receipt", async ({
  page,
}, info) => {
  await setup(page, { ...liveSession, presentation: "hold" });
  await (await destination(page, "/settings/youtube")).click();
  await dialog(page)
    .getByRole("button", { name: "Continue broadcast" })
    .click();
  // Settings requires authentication; the standard fixture server redirects to
  // login. The root provider must survive that settings navigation as well.
  await expect(page).toHaveURL(/\/(account|login)(?:\?|$)/);
  await expect(dialog(page)).toHaveCount(0);
  const banner = page.getByRole("complementary", {
    name: "Active Studio game",
  });
  await expect(banner.getByRole("status")).toHaveText("Broadcast paused");
  for (const control of await banner.locator("a,button").all())
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(`studio-settings-status-${info.project.name}.png`),
    fullPage: true,
  });
  await banner.getByRole("button", { name: "Resume broadcast" }).click();
  await expect
    .poll(async () => (await messages(page, "studio-youtube-resume")).length)
    .toBe(1);
  const [request] = await messages(page, "studio-youtube-resume");
  await presentationReceipt(page, request, {
    nonce: wrongNonce,
    presentation: { generation: 2, mode: "live" },
  });
  await expect(
    banner.getByRole("button", { name: "Please wait…" }),
  ).toBeDisabled();
  await expect(banner.getByRole("status")).toHaveText("Broadcast paused");
  await presentationReceipt(page, request, {
    presentation: { generation: 2, mode: "live" },
  });
  await status(page, { presentation: "live" });
  await expect(banner.getByRole("status")).toHaveText("Broadcast live");
  await expect(
    banner.getByRole("button", { name: "Pause broadcast" }),
  ).toBeEnabled();
});

test("native navigation resolves its nonce without routing the web app itself", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(
    ({ gameId, nonce }) => {
      window.dispatchEvent(
        new CustomEvent("studio-navigation-request", {
          detail: {
            gameId,
            nonce,
            href: new URL("/download", location.origin).href,
          },
        }),
      );
    },
    { gameId: testGameId, nonce: requestNonce },
  );
  await dialog(page)
    .getByRole("button", { name: "Continue broadcast" })
    .click();
  await expect
    .poll(
      async () => (await messages(page, "studio-navigation-resolve")).length,
    )
    .toBe(1);
  expect((await messages(page, "studio-navigation-resolve"))[0]).toEqual({
    type: "studio-navigation-resolve",
    gameId: testGameId,
    nonce: requestNonce,
    decision: "continue",
  });
  await page.evaluate(
    ({ gameId, nonce }) => {
      window.dispatchEvent(
        new CustomEvent("studio-navigation-result", {
          detail: { gameId, nonce, ok: true },
        }),
      );
    },
    { gameId: testGameId, nonce: wrongNonce },
  );
  await expect(dialog(page).getByRole("status")).toBeVisible();
  await page.evaluate(
    ({ gameId, nonce }) => {
      window.dispatchEvent(
        new CustomEvent("studio-navigation-result", {
          detail: {
            gameId,
            nonce,
            ok: false,
            error: "Native navigation rejected.",
          },
        }),
      );
    },
    { gameId: testGameId, nonce: requestNonce },
  );
  await expect(dialog(page).getByRole("alert")).toHaveText(
    "Native navigation rejected.",
  );
  await dialog(page).getByRole("button", { name: "Stay here" }).click();
  await expect
    .poll(
      async () => (await messages(page, "studio-navigation-resolve")).length,
    )
    .toBe(2);
  expect((await messages(page, "studio-navigation-resolve"))[1].decision).toBe(
    "stay",
  );
  await page.evaluate(
    ({ gameId, nonce }) => {
      window.dispatchEvent(
        new CustomEvent("studio-navigation-result", {
          detail: { gameId, nonce, ok: true },
        }),
      );
    },
    { gameId: testGameId, nonce: requestNonce },
  );
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(`/score/${testGameId}`);
  expect(await messages(page, "studio-youtube-hold")).toEqual([]);
});

test("cross-origin native requests and malformed session statuses cannot open a guard", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(
    ({ gameId, nonce }) => {
      for (const detail of [
        { gameId, nonce, href: "https://example.invalid/download" },
        {
          gameId: "22222222-2222-4222-8222-222222222222",
          nonce,
          href: new URL("/download", location.origin).href,
        },
      ])
        window.dispatchEvent(
          new CustomEvent("studio-navigation-request", { detail }),
        );
    },
    { gameId: testGameId, nonce: requestNonce },
  );
  await expect(dialog(page)).toHaveCount(0);
  await status(page, { active: false, outputActive: false, live: false });
  await page.evaluate(
    ({ gameId, nonce, session }) => {
      window.dispatchEvent(
        new CustomEvent("studio-navigation-request", {
          detail: { gameId, nonce, href: "https://example.invalid/download" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("studio-session-status", {
          detail: { ...session, unexpected: true },
        }),
      );
    },
    { gameId: testGameId, nonce: requestNonce, session: liveSession },
  );
  await (await destination(page)).click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Active Studio game" }),
  ).toHaveCount(0);
});

test("modifier and new-tab links preserve normal browser behavior", async ({
  page,
  context,
}) => {
  await setup(page);
  const link = await destination(page);
  await link.dispatchEvent("click", { button: 0, ctrlKey: true });
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(`/score/${testGameId}`);
  const newTabLink = await destination(page, "/download", "_blank");
  const popupPromise = context.waitForEvent("page");
  await newTabLink.click();
  const popup = await popupPromise;
  await popup.waitForURL(/\/download$/);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(`/score/${testGameId}`);
  await popup.close();
  expect(await messages(page, "studio-youtube-hold")).toEqual([]);
});

test("idle sessions navigate to new-game creation without a dialog", async ({
  page,
}) => {
  await setup(page, {
    ...liveSession,
    streaming: "idle",
    outputActive: false,
    live: false,
  });
  await (await destination(page, "/games/new")).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(dialog(page)).toHaveCount(0);
  await status(page, { active: false, gameId: null });
  await expect(
    page.getByRole("complementary", { name: "Active Studio game" }),
  ).toHaveCount(0);
});

test("a browser cannot acquire native session controls from a dispatched status event", async ({
  page,
}) => {
  await setup(page, liveSession, false);
  await status(page, liveSession);
  await (await destination(page)).click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Active Studio game" }),
  ).toHaveCount(0);
});

test("browser Back from the game offers Stay here and keeps the broadcast active", async ({
  page,
}) => {
  await setup(page);
  await (await destination(page)).click();
  await dialog(page)
    .getByRole("button", { name: "Continue broadcast" })
    .click();
  await expect(page).toHaveURL(/\/download$/);
  await page.getByRole("link", { name: "Return to game" }).click();
  await expect(page).toHaveURL(`/score/${testGameId}`);
  await page.goBack();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Stay here" }).click();
  await expect(page).toHaveURL(`/score/${testGameId}`);
  await expect(dialog(page)).toHaveCount(0);
  expect(await messages(page, "studio-youtube-stop")).toEqual([]);
  expect(await messages(page, "studio-youtube-hold")).toEqual([]);
});

test("switching an idle other-game preview requires its correlated stop receipt", async ({
  page,
}) => {
  await setup(page, {
    ...liveSession,
    gameId: otherGameId,
    outputActive: false,
    live: false,
    streaming: "idle",
  });
  const banner = page.getByRole("complementary", {
    name: "Active Studio game",
  });
  const switchButton = banner.getByRole("button", {
    name: "Switch Studio to this game",
  });
  await switchButton.click();
  const switchDialog = page.getByRole("dialog", {
    name: "Switch Studio to this game?",
  });
  await switchDialog
    .getByRole("button", { name: "Switch Studio game", exact: true })
    .click();
  await expect
    .poll(async () => (await messages(page, "studio-session-stop")).length)
    .toBe(1);
  const [stop] = await messages(page, "studio-session-stop");
  expect(stop.gameId).toBe(otherGameId);
  async function receipt(overrides: Record<string, unknown>) {
    await page.evaluate(
      ({ stop, overrides }) => {
        window.dispatchEvent(
          new CustomEvent("studio-session-stop-result", {
            detail: {
              gameId: stop.gameId,
              nonce: stop.nonce,
              ok: true,
              ...overrides,
            },
          }),
        );
      },
      { stop, overrides },
    );
  }
  await receipt({ nonce: wrongNonce });
  await expect(switchDialog.getByRole("status")).toHaveText(
    "Switching Studio game…",
  );
  await receipt({ ok: false, error: "Test output is still active." });
  await expect(switchDialog.getByRole("alert")).toHaveText(
    "Test output is still active.",
  );
  await expect(page).toHaveURL(`/score/${testGameId}`);
  await switchDialog.getByRole("button", { name: "Cancel" }).click();
  await status(page, { outputActive: true, live: true });
  await expect(switchButton).toHaveCount(0);
  await status(page, { outputActive: false, live: false });
  await switchButton.click();
  await switchDialog
    .getByRole("button", { name: "Switch Studio game", exact: true })
    .click();
  await expect
    .poll(async () => (await messages(page, "studio-session-stop")).length)
    .toBe(2);
  const second = (await messages(page, "studio-session-stop"))[1];
  const reloaded = page.waitForEvent("load");
  await page.evaluate(
    ({ second, session }) => {
      sessionStorage.setItem(
        "studio-fixture-after-reload",
        JSON.stringify({
          ...session,
          active: false,
          gameId: null,
          outputActive: false,
          live: false,
        }),
      );
      window.dispatchEvent(
        new CustomEvent("studio-session-stop-result", {
          detail: { gameId: second.gameId, nonce: second.nonce, ok: true },
        }),
      );
    },
    { second, session: liveSession },
  );
  await reloaded;
  await expect(
    page.getByRole("button", { name: "Save 1 point", exact: true }),
  ).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(page).toHaveURL(`/score/${testGameId}`);
});

test("busy and pending dialogs keep keyboard focus inside and Escape stays in the game", async ({
  page,
}) => {
  await setup(page, { ...liveSession, busy: true });
  const link = await destination(page);
  await link.click();
  const leave = dialog(page);
  const stay = leave.getByRole("button", { name: "Stay here" });
  await expect(stay).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(stay).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(stay).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(leave).toHaveCount(0);
  await expect(link).toBeFocused();
  await status(page, { busy: false });
  await link.click();
  await leave.getByRole("button", { name: "Pause broadcast" }).click();
  await expect(leave.getByRole("status")).toHaveText("Confirming your choice…");
  await page.keyboard.press("Tab");
  await expect(leave).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(leave).toBeVisible();
  await presentationReceipt(
    page,
    (await messages(page, "studio-youtube-hold"))[0],
    { ok: false, error: "Test hold cancelled." },
  );
  await page.keyboard.press("Escape");
  await expect(leave).toHaveCount(0);
  await expect(page).toHaveURL(`/score/${testGameId}`);
});
