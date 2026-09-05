import { expect, test, type BrowserContext } from "@playwright/test";

test("scheduled-game chooser claims Camera 1 and requests LiveKit as the device", async ({
  page,
  browser,
}) => {
  let claimed = false;
  let participantCredential = "";
  let claimNumber = 0;
  const game = () => ({
    id: "scheduled-game",
    createdAt: Date.now(),
    status: "active",
    config: {
      eventName: "League Night — Game 3",
      homeName: "Rocks",
      awayName: "Stones",
      homeColor: "#000000",
      awayColor: "#ffffff",
      scheduledEnds: 8,
      youtubeTitle: "",
      youtubeVisibility: "unlisted",
    },
    scoreEvents: [],
    layout: "split",
    broadcast: "idle",
    audioMuted: false,
    connections: { "camera-home": false, "camera-away": false, scorer: false },
    claims: claimed ? { "camera-home": "device-1" } : {},
    sponsors: [],
    sponsorMode: {
      active: false,
      style: "overlay",
      intervalSeconds: 10,
      startedAt: null,
      rotationOffset: 0,
      paused: false,
      mutedPrevious: false,
      muteDuring: false,
    },
  });
  const installRoutes = async (context: BrowserContext, operator: boolean) => {
    await context.route("**/api/games/scheduled-game", (route) =>
      route.fulfill({
        json: game(),
        headers: {
          "x-curlcast-operator": String(operator),
          "x-curlcast-account-role": operator ? "owner" : "",
        },
      }),
    );
    await context.route(
      "**/api/games/scheduled-game/invitations",
      async (route) => {
        const role = (await route.request().postDataJSON()).role;
        const parameter = role === "chooser" ? "chooser" : "token";
        await route.fulfill({
          json: {
            token: `${role}-invitation`,
            url: `http://127.0.0.1:3000/join/scheduled-game?${parameter}=${role}-invitation`,
            expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
          },
        });
      },
    );
    await context.route("**/api/games/scheduled-game/claim", async (route) => {
      claimed = true;
      participantCredential = `device-bound-camera-session-${++claimNumber}`;
      await route.fulfill({
        json: { role: "camera-home", sessionToken: participantCredential },
      });
    });
    await context.route(
      "**/api/games/scheduled-game/livekit-token*",
      async (route) => {
        expect(route.request().headers().cookie).toBeUndefined();
        if (new URL(route.request().url()).searchParams.has("capability"))
          expect(
            new URL(route.request().url()).searchParams.get("capability"),
          ).toBe("camera-publish");
        if (
          route.request().headers().authorization !==
          `Bearer ${participantCredential}`
        ) {
          await route.fulfill({ status: 401, json: { error: "unauthorized" } });
          return;
        }
        await route.fulfill({
          json: {
            url: "wss://live.example",
            token: "publish-only-camera-token",
          },
        });
      },
    );
    await context.route(
      "**/api/games/scheduled-game/disconnect-camera",
      async (route) => {
        await route.fulfill({ json: { disconnected: true } });
      },
    );
    await context.route(
      "**/api/games/scheduled-game/release-camera",
      async (route) => {
        claimed = false;
        participantCredential = "";
        await route.fulfill({ json: { disconnected: true, released: true } });
      },
    );
  };

  await installRoutes(page.context(), true);
  await page.goto("/games/scheduled-game");
  await expect(
    page.getByAltText("QR code to open the role chooser"),
  ).toBeVisible();
  const chooserUrl = await page
    .getByRole("link", { name: "Open role chooser" })
    .getAttribute("href");

  const participant = await browser.newContext();
  await installRoutes(participant, false);
  const camera = await participant.newPage();
  await camera.goto(chooserUrl!);
  for (const role of ["Camera 1", "Camera 2", "Scorekeeper + Audio"])
    await expect(
      camera.getByRole("button", { name: role, exact: false }),
    ).toBeEnabled();
  await camera.getByRole("button", { name: /Camera 1/ }).click();
  const credentialResponse = await camera.evaluate(async (credential) => {
    const response = await fetch("/api/games/scheduled-game/livekit-token", {
      method: "POST",
      headers: { authorization: `Bearer ${credential}` },
    });
    return { ok: response.ok, body: await response.json() };
  }, participantCredential);
  expect(credentialResponse.ok).toBe(true);
  expect(credentialResponse.body).toEqual({
    url: "wss://live.example",
    token: "publish-only-camera-token",
  });
  await expect(page.getByText("Claimed but offline")).toBeVisible();
  const releasedCredential = participantCredential;
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Release Camera" }).click();
  await expect(page.getByText("Unclaimed").first()).toBeVisible();
  const rejected = await camera.evaluate(async (credential) => {
    const response = await fetch("/api/games/scheduled-game/livekit-token", {
      method: "POST",
      headers: { authorization: `Bearer ${credential}` },
    });
    return response.status;
  }, releasedCredential);
  expect(rejected).toBe(401);

  const replacement = await browser.newContext();
  await installRoutes(replacement, false);
  const replacementCamera = await replacement.newPage();
  await replacementCamera.goto(chooserUrl!);
  await replacementCamera.getByRole("button", { name: /Camera 1/ }).click();
  expect(participantCredential).toBe("device-bound-camera-session-2");
  await expect(page.getByText("Claimed but offline")).toBeVisible();
  await replacement.close();
  await participant.close();
});
