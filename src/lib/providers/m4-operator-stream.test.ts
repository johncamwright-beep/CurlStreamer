import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { M4DesktopClient } from "./m4-desktop-client";
import { createM4OperatorServer } from "./m4-operator-server";

const gameId = "11111111-1111-4111-8111-111111111111";
const paths = {
  executable: "C:\\missing.exe",
  plugin: "C:\\missing.dll",
  runtime: "C:\\missing",
};
type StreamState =
  "idle" | "starting" | "armed" | "stopping" | "stopped" | "failed";

async function fixture(
  input: {
    streamingEnabled?: boolean;
    start?: () => Promise<ReturnType<typeof handle>>;
    streamStart?: (setState: (state: StreamState) => void) => Promise<void>;
    streamStop?: (setState: (state: StreamState) => void) => Promise<void>;
    observation?: object;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "m4-operator-stream-"));
  let streamState: StreamState = "idle";
  let finish!: (value: { finalized: boolean }) => void;
  const closed = new Promise<{ finalized: boolean }>(
    (resolve) => (finish = resolve),
  );
  const recordingStop = vi.fn(async () => finish({ finalized: true }));
  const streamStart = vi.fn(async () => {
    await input.streamStart?.((state) => (streamState = state));
    streamState = "armed";
  });
  const streamStop = vi.fn(async () => {
    await input.streamStop?.((state) => (streamState = state));
    streamState = "stopped";
  });
  function handle() {
    return {
      stop: recordingStop,
      closed,
      rendererAddress: "http://127.0.0.1:4000",
      stream: {
        start: streamStart,
        stop: streamStop,
        snapshot: () => ({ state: streamState, ...input.observation }),
      },
    };
  }
  const desktop = {
    challenge: "challenge",
    exchange: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    heartbeat: vi.fn(async () => ({ authorized: true })),
    snapshot: vi.fn(() => ({ state: "active", authorized: true })),
  } as unknown as M4DesktopClient;
  const app = await createM4OperatorServer({
    gameId,
    origin: "https://pilot.invalid",
    paths,
    desktop,
    check: async () => undefined,
    pairingEnabled: true,
    streamingEnabled: input.streamingEnabled ?? true,
    program: {
      realtimeUrl: "https://realtime.invalid",
      realtimeKey: "public-key",
      recorder: "C:\\recorder.exe",
      runtime: "C:\\runtime",
      recordingRoot: join(directory, "recordings"),
      cacheRoot: join(directory, "cache"),
      rendererRoot: join(directory, "renderer"),
      streamPlugin: "C:\\stream.dll",
      start: input.start ?? (async () => handle()),
    },
  });
  const page = await fetch(app.address);
  const cookie = page.headers.get("set-cookie")!.split(";")[0];
  const command = (value: unknown) =>
    fetch(`${app.address}/command`, {
      method: "POST",
      headers: {
        cookie,
        origin: app.address,
        "content-type": "application/json",
      },
      body: JSON.stringify(value),
    });
  const state = () =>
    fetch(`${app.address}/state`, { headers: { cookie } }).then((r) =>
      r.json(),
    );
  const ready = async () => {
    await command({ action: "check" });
    await command({ action: "pair", code: "c".repeat(43) });
    await command({ action: "start-program", invitation: "i".repeat(43) });
  };
  return {
    app,
    command,
    state,
    ready,
    directory,
    streamStart,
    streamStop,
    recordingStop,
    handle,
    setStreamState: (state: StreamState) => (streamState = state),
  };
}

describe("M4 operator streaming races", () => {
  it("does not confirm broadcast without fresh active bytes, even when provider is active", async () => {
    const f = await fixture({
      observation: {
        localOutput: { state: "active", bytes: 0 },
        provider: {
          streamStatus: "active",
          healthStatus: "good",
          broadcastStatus: "live",
          broadcastLive: true,
        },
        liveConfirmed: true,
      },
    });
    try {
      await f.ready();
      await f.command({
        action: "start-stream",
        intentId: crypto.randomUUID(),
      });
      expect(await f.state()).toMatchObject({
        localOutput: { state: "active", bytes: 0 },
        youtubeReception: "confirmed",
        broadcast: "unknown",
      });
      f.setStreamState("failed");
      expect(await f.state()).toMatchObject({ broadcast: "unknown" });
    } finally {
      await f.app.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  });
  it("keeps recording after an arm rejection and exposes autonomous stream failure", async () => {
    const f = await fixture({
      streamStart: async (setState) => {
        setState("failed");
        throw new Error("arm");
      },
    });
    try {
      await f.ready();
      expect(
        await (
          await f.command({
            action: "start-stream",
            intentId: crypto.randomUUID(),
          })
        ).json(),
      ).toMatchObject({ streaming: "failed", program: "recording" });
      expect(f.recordingStop).not.toHaveBeenCalled();
      f.setStreamState("failed");
      expect(await f.state()).toMatchObject({
        streaming: "failed",
        program: "recording",
      });
    } finally {
      await f.app.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("finalizes recording when stream stop rejects", async () => {
    const f = await fixture({
      streamStop: async (setState) => {
        setState("failed");
        throw new Error("stop");
      },
    });
    try {
      await f.ready();
      await f.command({
        action: "start-stream",
        intentId: crypto.randomUUID(),
      });
      expect(
        await (await f.command({ action: "stop-program" })).json(),
      ).toMatchObject({ program: "stopped", streaming: "failed" });
      expect(f.recordingStop).toHaveBeenCalledOnce();
    } finally {
      await f.app.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("does not claim a stopped stream when release cleanup rejects", async () => {
    const f = await fixture({
      streamStop: async (setState) => {
        setState("failed");
        throw new Error("stop");
      },
    });
    try {
      await f.ready();
      await f.command({
        action: "start-stream",
        intentId: crypto.randomUUID(),
      });
      expect(await (await f.command({ action: "stop" })).json()).toMatchObject({
        pairing: "stopped",
        streaming: "failed",
        program: "recording",
      });
    } finally {
      await f.app.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("rejects streaming while disabled even with paired recording and never arms", async () => {
    const f = await fixture({ streamingEnabled: false });
    try {
      await f.ready();
      expect(
        (
          await f.command({
            action: "start-stream",
            intentId: crypto.randomUUID(),
          })
        ).status,
      ).toBe(409);
      expect(f.streamStart).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("preserves a healthy late program after release, but closes it during app shutdown", async () => {
    let resolveStart!: (value: ReturnType<typeof lateHandle>) => void;
    let stop!: ReturnType<typeof vi.fn>;
    let finish!: (value: { finalized: boolean }) => void;
    const closed = new Promise<{ finalized: boolean }>(
      (resolve) => (finish = resolve),
    );
    function lateHandle() {
      stop = vi.fn(async () => finish({ finalized: true }));
      return {
        stop,
        closed,
        rendererAddress: "http://127.0.0.1:4000",
        stream: {
          start: vi.fn(async () => undefined),
          stop: vi.fn(async () => undefined),
          snapshot: () => ({ state: "idle" as const }),
        },
      };
    }
    const f = await fixture({
      start: () => new Promise((resolve) => (resolveStart = resolve)),
    });
    try {
      await f.command({ action: "check" });
      const pending = f.command({
        action: "start-program",
        invitation: "i".repeat(43),
      });
      await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
      await f.command({ action: "stop" });
      resolveStart(lateHandle());
      await pending;
      expect(await f.state()).toMatchObject({
        program: "recording",
        pairing: "stopped",
      });
      const closing = f.app.close();
      await closing;
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("waits for and stops a late program handle when the app closes", async () => {
    let resolveStart!: (value: ReturnType<typeof lateHandle>) => void;
    let stop!: ReturnType<typeof vi.fn>;
    let finish!: (value: { finalized: boolean }) => void;
    const closed = new Promise<{ finalized: boolean }>(
      (resolve) => (finish = resolve),
    );
    function lateHandle() {
      stop = vi.fn(async () => finish({ finalized: true }));
      return {
        stop,
        closed,
        rendererAddress: "http://127.0.0.1:4000",
        stream: {
          start: vi.fn(async () => undefined),
          stop: vi.fn(async () => undefined),
          snapshot: () => ({ state: "idle" as const }),
        },
      };
    }
    const f = await fixture({
      start: () => new Promise((resolve) => (resolveStart = resolve)),
    });
    try {
      await f.command({ action: "check" });
      void f.command({ action: "start-program", invitation: "i".repeat(43) });
      await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
      let completed = false;
      const closing = f.app.close().then(() => (completed = true));
      await Promise.resolve();
      expect(completed).toBe(false);
      resolveStart(lateHandle());
      await closing;
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });
});
