import { expect, test } from "@playwright/test";
import { testGameId } from "../src/test/game-fixture";

for (const lifecycle of ["deleted", "closed", "denied"] as const) {
  test(`Studio learns ${lifecycle} status without attempting to end the game again`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        value: "CurlStreamerStudio/0.3 StudioProgramPreview/1",
      });
      const messages: unknown[] = [];
      Object.assign(window, { nativeMessages: messages });
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          webview: {
            postMessage: (message: unknown) => messages.push(message),
          },
        },
      });
    });
    await page.route(`**/api/games/${testGameId}`, (route) =>
      route.fulfill({
        status: lifecycle === "denied" ? 403 : 410,
        json: {
          error: "This game is unavailable.",
          ...(lifecycle === "denied" ? {} : { lifecycle }),
        },
      }),
    );
    await page.goto(`/score/${testGameId}`);
    await expect(
      page.getByRole("heading", { name: "Scoring unavailable" }),
    ).toBeVisible();
    const terminalMessages = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            nativeMessages: { type: string; gameId: string }[];
          }
        ).nativeMessages.filter(
          (message) => message.type === "studio-game-ended",
        ),
      );
    if (lifecycle === "denied") {
      expect(await terminalMessages()).toEqual([]);
    } else {
      await expect
        .poll(terminalMessages)
        .toContainEqual({ type: "studio-game-ended", gameId: testGameId });
    }
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { nativeMessages: { type: string }[] }
        ).nativeMessages.some(
          (message) => message.type === "studio-game-ready",
        ),
      ),
    ).toBe(false);
  });
}
