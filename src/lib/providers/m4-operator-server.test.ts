import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createM4OperatorServer } from "./m4-operator-server";
import { M4DesktopClient } from "./m4-desktop-client";
import { checkM4NativeHost } from "./m4-native-preflight";
const gameId = "11111111-1111-4111-8111-111111111111";
const paths = {
  executable: process.env.CURLCAST_TEST_STUDIO_HOST ?? "C:\\missing.exe",
  plugin: process.env.CURLCAST_TEST_DEFAULT_PLUGIN ?? "C:\\missing.dll",
  runtime: process.env.CURLCAST_TEST_OBS_RUNTIME ?? "C:\\missing",
};
describe("local operator HTTP boundary", () => {
  it("rejects cross-origin and unknown commands; checks PC without target delivery", async () => {
    const desktop = new M4DesktopClient(gameId, "https://pilot.invalid");
    const check = vi.fn(async () => undefined);
    const pair = vi.spyOn(desktop, "exchange");
    const app = await createM4OperatorServer({
      gameId,
      origin: "https://pilot.invalid",
      paths,
      desktop,
      check,
    });
    try {
      expect((await fetch(`${app.address}/state`)).status).toBe(403);
      const page = await fetch(app.address);
      const cookie = page.headers.get("set-cookie")!.split(";")[0];
      expect(await page.text()).toContain("Streaming");
      const headers = {
        cookie,
        origin: app.address,
        "content-type": "application/json",
      };
      expect(
        (
          await fetch(`${app.address}/command`, {
            method: "POST",
            headers: { ...headers, origin: "https://evil.invalid" },
            body: '{"action":"check"}',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${app.address}/command`, {
            method: "POST",
            headers,
            body: '{"action":"start"}',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await fetch(`${app.address}/command`, {
            method: "POST",
            headers,
            body: '{"action":"check","extra":"value"}',
          })
        ).status,
      ).toBe(400);
      const response = await fetch(`${app.address}/command`, {
        method: "POST",
        headers,
        body: '{"action":"check"}',
      });
      expect(await response.json()).toMatchObject({
        pc: "ready",
        streamingAvailable: false,
        pairing: "unpaired",
      });
      expect(check).toHaveBeenCalledTimes(1);
      expect(pair).not.toHaveBeenCalled();
      const unavailablePair = await fetch(`${app.address}/command`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "pair", code: "c".repeat(43) }),
      });
      expect(unavailablePair.status).toBe(409);
      expect(pair).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it("arms only an authorized configured stream and stopping it preserves recording", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m4-operator-stream-"));
    let finish!: (result: { finalized: boolean }) => void;
    const closed = new Promise<{ finalized: boolean }>(
      (resolve) => (finish = resolve),
    );
    const calls: string[] = [];
    let streamState: "idle" | "armed" | "stopped" = "idle";
    const streamStart = vi.fn(async () => void (streamState = "armed"));
    const streamStop = vi.fn(async () => {
      calls.push("stream");
      streamState = "stopped";
    });
    const recordingStop = vi.fn(async () => {
      calls.push("recording");
      finish({ finalized: true });
    });
    const desktop = {
      challenge: "challenge",
      exchange: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      heartbeat: vi.fn(async () => ({ authorized: true })),
      snapshot: vi.fn(() => ({ state: "active", authorized: true })),
    } as unknown as M4DesktopClient;
    const start = vi.fn(async () => ({
      stop: recordingStop,
      closed,
      rendererAddress: "http://127.0.0.1:4000",
      stream: {
        start: streamStart,
        stop: streamStop,
        snapshot: () => ({ state: streamState }),
      },
    }));
    const app = await createM4OperatorServer({
      gameId,
      origin: "https://pilot.invalid",
      paths,
      desktop,
      pairingEnabled: true,
      streamingEnabled: true,
      check: async () => undefined,
      program: {
        realtimeUrl: "https://realtime.invalid",
        realtimeKey: "public-anon-key",
        recorder: "C:\\recorder.exe",
        runtime: "C:\\runtime",
        recordingRoot: join(directory, "recordings"),
        cacheRoot: join(directory, "cache"),
        rendererRoot: join(directory, "renderer"),
        streamPlugin: "C:\\stream.dll",
        start,
      },
    });
    try {
      const page = await fetch(app.address);
      const cookie = page.headers.get("set-cookie")!.split(";")[0];
      const headers = {
        cookie,
        origin: app.address,
        "content-type": "application/json",
      };
      const command = (value: unknown) =>
        fetch(`${app.address}/command`, {
          method: "POST",
          headers,
          body: JSON.stringify(value),
        });
      await command({ action: "check" });
      await command({ action: "pair", code: "c".repeat(43) });
      const recording = await command({
        action: "start-program",
        invitation: "i".repeat(43),
      });
      expect(await recording.json()).toMatchObject({
        program: "recording",
        pairing: "paired",
      });
      const state = await fetch(`${app.address}/state`, {
        headers: { cookie },
      });
      expect(await state.json()).toMatchObject({
        streamingAvailable: true,
        streaming: "idle",
      });
      const armed = await command({
        action: "start-stream",
        intentId: crypto.randomUUID(),
      });
      expect(await armed.json()).toMatchObject({
        streaming: "armed",
        program: "recording",
      });
      expect(streamStart).toHaveBeenCalledWith(desktop, expect.any(String));
      const stopped = await command({ action: "stop-stream" });
      expect(await stopped.json()).toMatchObject({
        streaming: "stopped",
        program: "recording",
      });
      expect(streamStop).toHaveBeenCalledOnce();
      expect(recordingStop).not.toHaveBeenCalled();
      await command({ action: "stop-program" });
      expect(recordingStop).toHaveBeenCalledOnce();
      expect(calls.slice(-2)).toEqual(["stream", "recording"]);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("cancels a pending stream arm without stopping the recording", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m4-operator-cancel-"));
    let finish!: (result: { finalized: boolean }) => void;
    let arm!: () => void;
    const closed = new Promise<{ finalized: boolean }>(
      (resolve) => (finish = resolve),
    );
    let streamState: "idle" | "starting" | "stopped" = "idle";
    const streamStart = vi.fn(() => {
      streamState = "starting";
      return new Promise<void>((resolve) => (arm = resolve));
    });
    const streamStop = vi.fn(async () => {
      streamState = "stopped";
      arm();
    });
    const recordingStop = vi.fn(async () => finish({ finalized: true }));
    const desktop = {
      challenge: "challenge",
      exchange: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      heartbeat: vi.fn(async () => ({ authorized: true })),
      snapshot: vi.fn(() => ({ state: "active", authorized: true })),
    } as unknown as M4DesktopClient;
    const start = vi.fn(async () => ({
      stop: recordingStop,
      closed,
      rendererAddress: "http://127.0.0.1:4000",
      stream: {
        start: streamStart,
        stop: streamStop,
        snapshot: () => ({ state: streamState }),
      },
    }));
    const app = await createM4OperatorServer({
      gameId,
      origin: "https://pilot.invalid",
      paths,
      desktop,
      pairingEnabled: true,
      streamingEnabled: true,
      check: async () => undefined,
      program: {
        realtimeUrl: "https://realtime.invalid",
        realtimeKey: "public-anon-key",
        recorder: "C:\\recorder.exe",
        runtime: "C:\\runtime",
        recordingRoot: join(directory, "recordings"),
        cacheRoot: join(directory, "cache"),
        rendererRoot: join(directory, "renderer"),
        streamPlugin: "C:\\stream.dll",
        start,
      },
    });
    try {
      const page = await fetch(app.address);
      const cookie = page.headers.get("set-cookie")!.split(";")[0];
      const headers = {
        cookie,
        origin: app.address,
        "content-type": "application/json",
      };
      const command = (value: unknown) =>
        fetch(`${app.address}/command`, {
          method: "POST",
          headers,
          body: JSON.stringify(value),
        });
      await command({ action: "check" });
      await command({ action: "pair", code: "c".repeat(43) });
      await command({ action: "start-program", invitation: "i".repeat(43) });
      const pending = command({
        action: "start-stream",
        intentId: crypto.randomUUID(),
      });
      await vi.waitFor(() => expect(streamStart).toHaveBeenCalledOnce());
      const cancelled = await command({ action: "stop-stream" });
      expect(await cancelled.json()).toMatchObject({
        streaming: "stopped",
        program: "recording",
      });
      await pending;
      expect(recordingStop).not.toHaveBeenCalled();
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("owns one private program recording and finalizes it independently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m4-operator-program-"));
    let finish!: (result: { finalized: boolean }) => void;
    const closed = new Promise<{ finalized: boolean }>((resolve) => {
      finish = resolve;
    });
    const stop = vi.fn(async () => finish({ finalized: true }));
    const start = vi.fn(async (_invitation: string, _recording: string) => ({
      stop,
      closed,
      rendererAddress: "http://127.0.0.1:4000",
    }));
    const app = await createM4OperatorServer({
      gameId,
      origin: "https://pilot.invalid",
      paths,
      check: async () => undefined,
      program: {
        realtimeUrl: "https://realtime.invalid",
        realtimeKey: "public-anon-key",
        recorder: "C:\\recorder.exe",
        runtime: "C:\\runtime",
        recordingRoot: join(directory, "recordings"),
        cacheRoot: join(directory, "cache"),
        rendererRoot: join(directory, "renderer"),
        start,
      },
    });
    try {
      const page = await fetch(app.address);
      const cookie = page.headers.get("set-cookie")!.split(";")[0];
      expect(await page.text()).toContain("Local program recording");
      const headers = {
        cookie,
        origin: app.address,
        "content-type": "application/json",
      };
      await fetch(`${app.address}/command`, {
        method: "POST",
        headers,
        body: '{"action":"check"}',
      });
      const invitation = "i".repeat(43);
      const sourceUrl = `https://pilot.invalid/studio-m3/${gameId}/program#code=${invitation}`;
      const started = await fetch(`${app.address}/command`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "start-program",
          invitation: sourceUrl,
        }),
      });
      const running = await started.json();
      expect(running).toMatchObject({
        programAvailable: true,
        program: "recording",
      });
      expect(JSON.stringify(running)).not.toContain(invitation);
      expect(start).toHaveBeenCalledOnce();
      expect(start.mock.calls[0][0]).toBe(invitation);
      expect(start.mock.calls[0][1]).toMatch(/\.mkv$/);
      const stopped = await fetch(`${app.address}/command`, {
        method: "POST",
        headers,
        body: '{"action":"stop-program"}',
      });
      expect(await stopped.json()).toMatchObject({ program: "stopped" });
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
describe.skipIf(!process.env.CURLCAST_TEST_STUDIO_HOST)(
  "real native PC check",
  () => {
    it("connects and stops the unarmed service without pairing or a target", async () => {
      await expect(checkM4NativeHost(paths)).resolves.toBeUndefined();
    }, 10000);
  },
);
