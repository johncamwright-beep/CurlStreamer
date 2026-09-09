import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";
import path from "node:path";

const game = "00000000-0000-4000-8000-000000000001";
const base = `/studio-m2/${game}`;

test("two accessible receiver slots scope registration and invitations independently", async ({
  page,
}) => {
  const calls: Array<{ action?: string; cameraRole?: string; role?: string }> =
    [];
  await page.route(`**/api/games/${game}/studio-m2`, async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    await route.fulfill({
      json: {
        cameraRole: body.cameraRole,
        sessionId:
          body.cameraRole === "camera-home"
            ? "00000000-0000-4000-8000-000000000002"
            : "00000000-0000-4000-8000-000000000003",
        generation: 1,
        negotiationId: null,
        assignmentGeneration: null,
        expiresAt: Date.now() + 30_000,
      },
    });
  });
  await page.route(`**/api/games/${game}/invitations`, async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ json: { token: "synthetic-unused-invitation" } });
  });
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "Start both 2.5-hour tests" }),
  ).toBeDisabled();
  for (const [label, role] of [
    ["Camera 1", "camera-home"],
    ["Camera 2", "camera-away"],
  ]) {
    const slot = page.getByRole("region", { name: label, exact: true });
    const video = slot.locator("video");
    await expect(video).toBeVisible();
    expect(
      await video.evaluate((element) => getComputedStyle(element).objectFit),
    ).toBe("contain");
    expect(
      await video.evaluate(
        (element) => (element as HTMLVideoElement).srcObject,
      ),
    ).toBeNull();
    const controls = slot.getByRole("button");
    for (let i = 0; i < (await controls.count()); i++) {
      expect(
        (await controls.nth(i).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    }
    await expect(
      slot.getByRole("button", { name: "Connect receiver" }),
    ).toBeDisabled();
    await slot.getByRole("button", { name: "Register PC" }).click();
    await expect(
      slot.getByRole("button", { name: "Connect receiver" }),
    ).toBeEnabled();
    await slot
      .getByRole("button", { name: "Create camera invitation" })
      .click();
    await expect(
      slot.getByRole("img", { name: "One-use camera invitation QR code" }),
    ).toBeVisible();
    expect(calls).toContainEqual({
      action: "register",
      side: "receiver",
      cameraRole: role,
    });
    expect(calls).toContainEqual({ role });
  }
  await page
    .getByRole("region", { name: "Camera 1", exact: true })
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Camera 2", exact: true })
      .getByRole("button", { name: "Connect receiver" }),
  ).toBeEnabled();
});

test("camera-away fresh invitation supersedes saved access and claims only that role", async ({
  page,
}) => {
  await page.addInitScript(
    ({ id }) => {
      const saved =
        "test." +
        btoa(
          JSON.stringify({
            gameId: id,
            purpose: "participant",
            role: "camera-away",
            exp: Date.now() / 1000 + 3600,
          }),
        ) +
        ".test";
      localStorage.setItem(`curlcast-participant-access-${id}`, saved);
    },
    { id: game },
  );
  const claims: unknown[] = [];
  await page.route(`**/api/games/${game}/claim`, async (route) => {
    claims.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        role: "camera-away",
        sessionToken: "synthetic-new-camera-away-access",
      },
    });
  });
  await page.goto(`${base}/camera/camera-away#token=synthetic-fresh-away`);
  await expect(page.getByRole("status")).toContainText(
    "New invitation received",
  );
  await expect(
    page.getByRole("button", { name: "Start or reconnect camera" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Claim camera", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start or reconnect camera" }),
  ).toBeEnabled();
  expect(claims).toEqual([
    { token: "synthetic-fresh-away", claimant: expect.any(String) },
  ]);
  expect(
    await page
      .locator("video")
      .evaluate((element) => (element as HTMLVideoElement).srcObject),
  ).toBeNull();
  expect(
    await page
      .locator("video")
      .evaluate((element) => getComputedStyle(element).objectFit),
  ).toBe("contain");
});

test("unsupported camera role cannot render a capture surface", async ({
  page,
}) => {
  await page.goto(`${base}/camera/scorer`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
});

test("two synthetic DirectPeer video pairs remain independent through replacement", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Browser-only synthetic transport evidence, not physical LAN or endurance proof.
  await page.goto(base);
  const bundle = buildSync({
    entryPoints: [path.resolve("src/lib/providers/direct-peer.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "M2Peer",
    platform: "browser",
    tsconfig: path.resolve("tsconfig.json"),
  }).outputFiles[0].text;
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    type Metrics = {
      direct: boolean;
      relayBytes: number;
      framesDecoded: number;
    };
    type Peer = {
      receive: (signal: unknown) => Promise<void>;
      inspect: () => Promise<Metrics>;
      close: () => void;
      pc: RTCPeerConnection;
    };
    const { DirectPeer } = (
      window as unknown as {
        M2Peer: { DirectPeer: new (options: Record<string, unknown>) => Peer };
      }
    ).M2Peer;
    const videos = [...document.querySelectorAll("video")];
    const failures: string[] = [];
    const allPairs: Array<{
      camera: Peer;
      receiver: Peer;
      track: MediaStreamTrack;
      draw: ReturnType<typeof setInterval>;
    }> = [];
    function pair(slot: number) {
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 1280;
      const context = canvas.getContext("2d")!;
      let frame = 0;
      const draw = setInterval(() => {
        context.fillStyle = frame++ % 2 ? "#10b981" : "#2563eb";
        context.fillRect(0, 0, 720, 1280);
        context.fillStyle = "white";
        context.fillText(
          `SYNTHETIC CAMERA ${slot + 1} FRAME ${frame}`,
          40,
          100,
        );
      }, 50);
      const track = canvas.captureStream(20).getVideoTracks()[0];
      let camera: Peer, receiver: Peer;
      const onFailure = (reason: string) => {
        failures.push(reason);
      };
      camera = new DirectPeer({
        side: "camera",
        track,
        onVideo: () => {},
        onFailure,
        send: async (signal: unknown) => {
          void receiver.receive(signal);
        },
      });
      receiver = new DirectPeer({
        side: "receiver",
        onFailure,
        send: async (signal: unknown) => {
          void camera.receive(signal);
        },
        onVideo: (stream: MediaStream) => {
          videos[slot].srcObject = stream;
          void videos[slot].play();
        },
      });
      const value = { camera, receiver, track, draw };
      allPairs.push(value);
      return value;
    }
    async function waitFrames(
      pairs: ReturnType<typeof pair>[],
      minimums: number[],
    ) {
      const deadline = Date.now() + 18_000;
      let metrics: Metrics[] = [];
      while (Date.now() < deadline && failures.length === 0) {
        metrics = await Promise.all(
          pairs.map((value) => value.receiver.inspect()),
        );
        await Promise.all(pairs.map((value) => value.camera.inspect()));
        if (
          metrics.every(
            (value, index) =>
              value.direct && value.framesDecoded > minimums[index],
          )
        )
          return metrics;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw Error(
        `Synthetic pairs did not advance: ${JSON.stringify({ metrics, failures })}`,
      );
    }
    let first = pair(0);
    const second = pair(1);
    try {
      await Promise.all([
        first.receiver.receive({ type: "ready" }),
        second.receiver.receive({ type: "ready" }),
      ]);
      const before = await waitFrames([first, second], [5, 5]);
      const oldFirst = first;
      oldFirst.camera.close();
      oldFirst.receiver.close();
      clearInterval(oldFirst.draw);
      oldFirst.track.stop();
      first = pair(0);
      await first.receiver.receive({ type: "ready" });
      const after = await waitFrames(
        [first, second],
        [5, before[1].framesDecoded + 5],
      );
      return {
        before,
        after,
        failures,
        oldClosed: oldFirst.receiver.pc.connectionState === "closed",
        secondTrack: second.track.readyState,
        dimensions: videos.map((video) => ({
          width: video.videoWidth,
          height: video.videoHeight,
        })),
      };
    } finally {
      for (const value of allPairs) {
        value.camera.close();
        value.receiver.close();
        value.track.stop();
        clearInterval(value.draw);
      }
      for (const video of videos) video.srcObject = null;
    }
  });
  expect(result.failures).toEqual([]);
  expect(result.oldClosed).toBe(true);
  expect(result.secondTrack).toBe("live");
  expect(result.after[1].framesDecoded).toBeGreaterThan(
    result.before[1].framesDecoded + 5,
  );
  for (const metrics of [...result.before, ...result.after]) {
    expect(metrics.direct).toBe(true);
    expect(metrics.relayBytes).toBe(0);
  }
  expect(result.dimensions).toEqual([
    { width: 720, height: 1280 },
    { width: 720, height: 1280 },
  ]);
});
