import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";
import path from "node:path";
const game = "00000000-0000-4000-8000-000000000001";

test("fresh invitation enables claiming over a saved released token", async ({
  page,
}) => {
  await page.addInitScript(
    ({ id }) => {
      const token =
        "test." +
        btoa(
          JSON.stringify({
            gameId: id,
            purpose: "participant",
            role: "camera-home",
            exp: Date.now() / 1000 + 3600,
          }),
        ) +
        ".test";
      localStorage.setItem(`curlcast-participant-access-${id}`, token);
    },
    { id: game },
  );
  await page.goto(
    "/studio-spike/" + game + "/camera#token=synthetic-unused-invitation",
  );
  await expect(
    page.getByRole("button", { name: "Claim Camera 1", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("status")).toContainText(
    "New invitation received",
  );
  await expect(
    page.getByRole("button", {
      name: "Start or reconnect camera",
      exact: true,
    }),
  ).toBeDisabled();
  // No real invitation is redeemed; verify same-tab arrival after loading saved access.
  await page.goto("/studio-spike/" + game + "/camera");
  await expect(
    page.getByRole("button", { name: "Claim Camera 1", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    location.hash = "token=synthetic-second-invitation";
  });
  await expect(
    page.getByRole("button", { name: "Claim Camera 1", exact: true }),
  ).toBeEnabled();
});

test("M1 phone and PC surfaces preserve frames and require explicit capture", async ({
  page,
}) => {
  for (const suffix of ["", "/camera"]) {
    await page.goto("/studio-spike/" + game + suffix);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    expect(
      await video.evaluate((element) => getComputedStyle(element).objectFit),
    ).toBe("contain");
    expect(
      await video.evaluate(
        (element) => (element as HTMLVideoElement).srcObject,
      ),
    ).toBeNull();
    const buttons = page.locator("main").getByRole("button");
    for (let i = 0; i < (await buttons.count()); i++)
      expect(
        (await buttons.nth(i).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("status")).toContainText(
      suffix ? "Claim Camera 1" : "Register this PC",
    );
    if (suffix)
      await expect(
        page.getByRole("button", { name: "Start or reconnect camera" }),
      ).toBeDisabled();
  }
});

test("actual DirectPeer transports synthetic portrait video over host-only WebRTC", async ({
  page,
}) => {
  // Synthetic browser transport evidence, explicitly not physical LAN/endurance proof.
  await page.goto("/studio-spike/" + game);
  const bundle = buildSync({
    entryPoints: [path.resolve("src/lib/providers/direct-peer.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "M1Peer",
    platform: "browser",
    tsconfig: path.resolve("tsconfig.json"),
  }).outputFiles[0].text;
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    type Peer = {
      receive: (signal: unknown) => Promise<void>;
      inspect: () => Promise<{
        direct: boolean;
        relayBytes: number;
        framesDecoded: number;
      }>;
      close: () => void;
      pc: RTCPeerConnection;
    };
    const global = window as unknown as {
      M1Peer: { DirectPeer: new (options: Record<string, unknown>) => Peer };
    };
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const context = canvas.getContext("2d")!;
    let frame = 0;
    const draw = setInterval(() => {
      context.fillStyle = frame++ % 2 ? "#10b981" : "#2563eb";
      context.fillRect(0, 0, 720, 1280);
      context.fillStyle = "white";
      context.fillText("SYNTHETIC M1 FRAME " + frame, 40, 100);
    }, 50);
    const track = canvas.captureStream(20).getVideoTracks()[0];
    const video = document.querySelector("video")!;
    let camera: Peer,
      receiver: Peer,
      failed = false,
      attached = false;
    camera = new global.M1Peer.DirectPeer({
      side: "camera",
      track,
      send: (signal: unknown) => {
        void receiver.receive(signal);
        return Promise.resolve();
      },
      onVideo: () => {},
      onFailure: () => {
        failed = true;
      },
    });
    receiver = new global.M1Peer.DirectPeer({
      side: "receiver",
      send: (signal: unknown) => {
        void camera.receive(signal);
        return Promise.resolve();
      },
      onVideo: (stream: MediaStream) => {
        if (!attached) {
          attached = true;
          video.srcObject = stream;
          void video.play();
        }
      },
      onFailure: () => {
        failed = true;
      },
    });
    try {
      await receiver.receive({ type: "ready" });
      const deadline = Date.now() + 15_000;
      let metrics;
      while (Date.now() < deadline && !failed) {
        metrics = await receiver.inspect();
        await camera.inspect();
        if (
          metrics.direct &&
          metrics.framesDecoded > 5 &&
          video.videoWidth === 720 &&
          video.videoHeight === 1280
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const dimensions = { width: video.videoWidth, height: video.videoHeight };
      await receiver.receive({
        type: "ice",
        candidate: {
          candidate: "candidate:1 1 udp 100 192.168.8.4 1234 typ relay",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      });
      return {
        metrics,
        dimensions,
        relayRejected: receiver.pc.connectionState === "closed",
        attached,
      };
    } finally {
      camera.close();
      receiver.close();
      track.stop();
      clearInterval(draw);
      video.srcObject = null;
    }
  });
  expect(result.metrics?.direct).toBe(true);
  expect(result.metrics?.relayBytes).toBe(0);
  expect(result.metrics!.framesDecoded).toBeGreaterThan(5);
  expect(result.dimensions).toEqual({ width: 720, height: 1280 });
  expect(result.attached).toBe(true);
  expect(result.relayRejected).toBe(true);
});
