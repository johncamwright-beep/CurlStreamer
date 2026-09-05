import { expect, test } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

function token(payload: object) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("signed-in viewer or outsider falls back to credential-free public Broadcast", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "curlcast-test-account",
      value: "signed-in",
      url: "http://127.0.0.1:3000",
    },
  ]);
  await page.addInitScript(
    ({ id, stale }) => localStorage.setItem(`curlcast-access-${id}`, stale),
    {
      id: testGameId,
      stale: token({ purpose: "organizer", gameId: "other-game", exp: 1 }),
    },
  );
  let publicState = 0;
  let publicMedia = 0;
  await page.route(`**/api/games/${testGameId}?view=broadcast`, (route) => {
    const headers = route.request().headers();
    if (headers.cookie) return route.fulfill({ status: 401, json: {} });
    expect(headers.authorization).toBeUndefined();
    publicState += 1;
    return route.fulfill({ json: gameFixture() });
  });
  await page.route(`**/api/games/${testGameId}/livekit-token*`, (route) => {
    const capability = new URL(route.request().url()).searchParams.get(
      "capability",
    );
    const headers = route.request().headers();
    if (capability === "preview-subscribe") {
      expect(headers.cookie).toContain("curlcast-test-account=signed-in");
      return route.fulfill({ status: 401, json: {} });
    }
    expect(capability).toBe("public-viewer");
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    publicMedia += 1;
    return route.fulfill({
      json: { url: "wss://127.0.0.1:9", token: "subscriber-only" },
    });
  });

  await page.goto(`/broadcast/${testGameId}`);
  await expect(page.getByTestId("broadcast-fixed-canvas")).toBeVisible();
  await expect.poll(() => publicState).toBeGreaterThan(0);
  await expect.poll(() => publicMedia).toBeGreaterThanOrEqual(2);
});

test("scorer participant uses preview-subscribe without public fallback", async ({
  page,
}) => {
  const scorer = token({
    purpose: "participant",
    gameId: testGameId,
    role: "scorer",
  });
  await page.addInitScript(
    ({ id, credential }) =>
      localStorage.setItem(`curlcast-access-${id}`, credential),
    { id: testGameId, credential: scorer },
  );
  let previews = 0;
  let publicRequests = 0;
  await page.route(`**/api/games/${testGameId}?view=broadcast`, (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${scorer}`);
    return route.fulfill({ json: gameFixture() });
  });
  await page.route(`**/api/games/${testGameId}/livekit-token*`, (route) => {
    const capability = new URL(route.request().url()).searchParams.get(
      "capability",
    );
    if (capability === "public-viewer") publicRequests += 1;
    else {
      expect(capability).toBe("preview-subscribe");
      expect(route.request().headers().authorization).toBe(`Bearer ${scorer}`);
      previews += 1;
    }
    return route.fulfill({
      json: { url: "wss://127.0.0.1:9", token: "subscriber-only" },
    });
  });

  await page.goto(`/broadcast/${testGameId}`);
  await expect(page.getByTestId("broadcast-fixed-canvas")).toBeVisible();
  await expect.poll(() => previews).toBeGreaterThanOrEqual(2);
  expect(publicRequests).toBe(0);
});

test("signed-in camera uses its preserved role token for camera-publish", async ({
  context,
  page,
}) => {
  const organizer = token({ purpose: "organizer", gameId: testGameId });
  const camera = token({
    purpose: "participant",
    gameId: testGameId,
    role: "camera-home",
  });
  await context.addCookies([
    {
      name: "curlcast-test-account",
      value: "signed-in",
      url: "http://127.0.0.1:3000",
    },
  ]);
  await page.addInitScript(
    ({ id, organizerToken, cameraToken }) => {
      localStorage.setItem(`curlcast-access-${id}`, organizerToken);
      localStorage.setItem(`curlcast-participant-access-${id}`, cameraToken);
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 1280;
      const stream = canvas.captureStream(30);
      const drawing = canvas.getContext("2d")!;
      let frame = 0;
      window.setInterval(() => {
        drawing.fillStyle = frame++ % 2 ? "#001122" : "#112233";
        drawing.fillRect(0, 0, canvas.width, canvas.height);
      }, 50);
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => stream,
          enumerateDevices: async () => [],
        },
      });
    },
    {
      id: testGameId,
      organizerToken: organizer,
      cameraToken: camera,
    },
  );
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({ json: gameFixture() }),
  );
  let cameraRequests = 0;
  await page.route(`**/api/games/${testGameId}/livekit-token*`, (route) => {
    expect(new URL(route.request().url()).searchParams.get("capability")).toBe(
      "camera-publish",
    );
    expect(route.request().headers().authorization).toBe(`Bearer ${camera}`);
    expect(route.request().headers().cookie).toContain(
      "curlcast-test-account=signed-in",
    );
    cameraRequests += 1;
    return route.fulfill({ status: 503, json: { error: "mock provider" } });
  });

  await page.goto(`/camera/${testGameId}/camera-home`);
  await page.getByRole("button", { name: "Connect Camera" }).click();
  await expect.poll(() => cameraRequests).toBe(1);
});
