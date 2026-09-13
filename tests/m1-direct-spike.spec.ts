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
  await page.route("**/studio-spike/" + game, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<video autoplay muted playsinline></video>",
    }),
  );
  await page.goto("/studio-spike/" + game);
  const bundle = buildSync({
    stdin: {
      contents:
        "export {DirectPeer} from './src/lib/providers/direct-peer'; export {createRemoteAudioPlayout} from './src/lib/remote-audio-playout';",
      resolveDir: process.cwd(),
      loader: "ts",
    },
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
      replaceAudioTrack: (track: MediaStreamTrack | null) => Promise<void>;
      pc: RTCPeerConnection;
    };
    const global = window as unknown as {
      M1Peer: {
        DirectPeer: new (options: Record<string, unknown>) => Peer;
        createRemoteAudioPlayout: (stream: MediaStream) => {
          start: () => Promise<void>;
          stop: () => void;
        };
      };
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
    const audioContext = new AudioContext();
    await audioContext.resume();
    const tone = audioContext.createOscillator();
    const toneLevel = audioContext.createGain();
    toneLevel.gain.value = 0.1;
    const microphone = audioContext.createMediaStreamDestination();
    tone.connect(toneLevel);
    const inputMeter = audioContext.createAnalyser();
    toneLevel.connect(inputMeter);
    toneLevel.connect(microphone);
    tone.start();
    const audioTrack = microphone.stream.getAudioTracks()[0];
    const analyser = audioContext.createAnalyser();
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    analyser.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    let audioSource: MediaStreamAudioSourceNode | undefined;
    let playout:
      ReturnType<typeof global.M1Peer.createRemoteAudioPlayout> | undefined;
    const samples = new Float32Array(analyser.fftSize);
    const audioRms = () => {
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
      );
    };
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
      onAudio: (stream: MediaStream) => {
        playout?.stop();
        playout = global.M1Peer.createRemoteAudioPlayout(stream);
        void playout.start();
        audioSource?.disconnect();
        audioSource = audioContext.createMediaStreamSource(stream);
        audioSource.connect(analyser);
      },
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
      // Enable a phone mic after video connects, using the reserved audio sender.
      await camera.replaceAudioTrack(audioTrack);
      const audioDeadline = Date.now() + 5000;
      let receivedAudio = 0;
      while (Date.now() < audioDeadline) {
        await receiver.inspect();
        await camera.inspect();
        receivedAudio = audioRms();
        if (receivedAudio > 0.01) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const audioStats: unknown[] = [];
      for (const peer of [camera, receiver])
        (await peer.pc.getStats()).forEach((s) => {
          if (s.kind === "audio" || s.mediaType === "audio")
            audioStats.push({
              type: s.type,
              bytesSent: s.bytesSent,
              bytesReceived: s.bytesReceived,
              energy: s.totalAudioEnergy,
              audioLevel: s.audioLevel,
              packets: s.packetsReceived,
            });
        });
      inputMeter.getFloatTimeDomainData(samples);
      const inputRms = Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
      );
      await camera.replaceAudioTrack(null);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const mutedAudio = audioRms();
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
        receivedAudio,
        mutedAudio,
        audioDiagnostics: {
          inputRms,
          audioStats,
          context: audioContext.state,
          sourceAttached: Boolean(audioSource),
          camera: camera.pc.getTransceivers().map((t) => ({
            mid: t.mid,
            direction: t.direction,
            current: t.currentDirection,
            kind: t.sender.track?.kind,
          })),
          receiver: receiver.pc.getTransceivers().map((t) => ({
            mid: t.mid,
            direction: t.direction,
            current: t.currentDirection,
            kind: t.receiver.track.kind,
            muted: t.receiver.track.muted,
          })),
        },
      };
    } finally {
      camera.close();
      receiver.close();
      track.stop();
      clearInterval(draw);
      video.srcObject = null;
      audioTrack.stop();
      playout?.stop();
      tone.stop();
      audioSource?.disconnect();
      await audioContext.close();
    }
  });
  expect(result.metrics?.direct).toBe(true);
  expect(result.metrics?.relayBytes).toBe(0);
  expect(result.metrics!.framesDecoded).toBeGreaterThan(5);
  expect(result.dimensions).toEqual({ width: 720, height: 1280 });
  expect(result.attached).toBe(true);
  expect(result.relayRejected).toBe(true);
  expect(
    result.receivedAudio,
    JSON.stringify(result.audioDiagnostics),
  ).toBeGreaterThan(0.01);
  expect(result.mutedAudio).toBeLessThan(0.001);
});
