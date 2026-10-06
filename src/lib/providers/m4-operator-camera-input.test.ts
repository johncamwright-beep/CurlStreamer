import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createM4OperatorServer } from "./m4-operator-server";

const gameId = "11111111-1111-4111-8111-111111111111";
const source = {
  kind: "tapo",
  host: "192.168.1.40",
  username: "private-camera-user",
  password: "private-camera-password",
  stream: "stream2",
  rotation: 90,
};
const configure = (cameraRole = "camera-home", input: unknown = source) => ({
  action: "configure-camera-input",
  cameraRole,
  source: input,
});
const reconnect = (cameraRole = "camera-home") => ({
  action: "reconnect-camera-input",
  cameraRole,
});
const zoom = (generation = 1, value = 2, cameraRole = "camera-home") => ({
  action: "set-camera-zoom",
  cameraRole,
  generation,
  value,
});
async function fixture(startGate?: Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "m4-input-operator-"));
  let finalize!: (result: { finalized: boolean }) => void;
  let entered!: () => void;
  const startEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const closed = new Promise<{ finalized: boolean }>((resolve) => {
    finalize = resolve;
  });
  const status = { "camera-home": false, "camera-away": false };
  const stopPhone = vi.fn(async () => undefined);
  const start = vi.fn(async () => {
    entered();
    await startGate;
    return {
      closed,
      stop: async () => finalize({ finalized: true }),
      rendererAddress: "http://127.0.0.1:4000",
      stopPhone,
      cameraStatus: () => ({ ...status }),
    };
  });
  const app = await createM4OperatorServer({
    gameId,
    origin: "https://pilot.invalid",
    paths: {
      executable: "C:\\missing.exe",
      plugin: "C:\\missing.dll",
      runtime: "C:\\missing",
    },
    check: async () => undefined,
    program: {
      realtimeUrl: "https://realtime.invalid",
      realtimeKey: "public-key",
      recorder: "C:\\recorder.exe",
      runtime: "C:\\runtime",
      recordingRoot: join(directory, "recordings"),
      cacheRoot: join(directory, "cache"),
      rendererRoot: join(directory, "renderer"),
      start,
    },
  });
  const page = await fetch(app.address);
  const cookie = page.headers.get("set-cookie")!.split(";")[0];
  const headers = {
    cookie,
    origin: app.address,
    "content-type": "application/json",
  };
  const send = (input: unknown, overrides: Record<string, string> = {}) =>
    fetch(`${app.address}/command`, {
      method: "POST",
      headers: { ...headers, ...overrides },
      body: JSON.stringify(input),
    });
  const state = async () =>
    (await fetch(`${app.address}/state`, { headers })).json();
  const startProgram = async () => {
    expect((await send({ action: "check" })).status).toBe(200);
    return send({ action: "start-program", invitation: "i".repeat(43) });
  };
  return {
    app,
    send,
    state,
    start,
    startEntered,
    startProgram,
    status,
    stopPhone,
    async close() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe("operator camera input commands", () => {
  it("permits zoom only for the active generation and preserves independent private state", async () => {
    const f = await fixture();
    try {
      await f.send(configure());
      expect((await f.send(zoom())).status).toBe(409);
      expect((await f.startProgram()).status).toBe(200);
      const generation = (await f.state()).cameraInputs["camera-home"]
        .generation;
      expect((await f.send(zoom(generation, 2, "camera-away"))).status).toBe(
        409,
      );
      expect((await f.send(zoom(generation - 1))).status).toBe(409);
      const response = await f.send(zoom(generation, 2.3));
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toMatch(
        /private-camera-user|private-camera-password|username|password|rtsp:/,
      );
      expect(JSON.parse(text).cameraInputs).toMatchObject({
        "camera-home": { generation, zoom: 2.3 },
        "camera-away": { zoom: 1 },
      });
      expect((await f.send(reconnect())).status).toBe(200);
      expect((await f.state()).cameraInputs["camera-home"].zoom).toBe(2.3);
      expect((await f.send(zoom(generation))).status).toBe(409);
      await f.send(configure());
      const replacement = (await f.state()).cameraInputs["camera-home"];
      expect(replacement.zoom).toBe(1);
      expect((await f.send({ action: "stop-program" })).status).toBe(200);
      expect((await f.send(zoom(replacement.generation))).status).toBe(409);
    } finally {
      await f.close();
    }
  });
  it("switches and reconnects a generic private RTSP slot without leaking endpoint secrets", async () => {
    const f = await fixture();
    try {
      expect((await f.startProgram()).status).toBe(200);
      const result = await f.send(
        configure("camera-away", {
          kind: "rtsp",
          host: "192.168.1.30",
          port: 8554,
          path: "/live?key=private-query",
          username: "",
          password: "",
          rotation: 180,
        }),
      );
      expect(result.status).toBe(200);
      const text = await result.text();
      expect(text).not.toMatch(
        /private-query|192\.168\.1\.30|8554|username|password|rtsp:/,
      );
      expect(JSON.parse(text).cameraInputs["camera-away"]).toMatchObject({
        kind: "rtsp",
        host: null,
        stream: null,
        rotation: 180,
        configured: true,
      });
      expect(f.stopPhone.mock.calls).toEqual([["camera-away"]]);
      expect((await f.send(reconnect("camera-away"))).status).toBe(200);
      expect((await f.state()).cameraInputs["camera-home"].kind).toBe("phone");
    } finally {
      await f.close();
    }
  });
  it("requires the operator cookie and origin and rejects commands outside the selected game's schema", async () => {
    const f = await fixture();
    try {
      const deniedHeaders: Record<string, string>[] = [
        { cookie: "" },
        { cookie: "m4_operator=untrusted" },
        { origin: "https://evil.invalid" },
        { origin: "" },
      ];
      for (const overrides of deniedHeaders) {
        expect((await f.send(configure(), overrides)).status).toBe(403);
        expect((await f.send(reconnect(), overrides)).status).toBe(403);
        expect((await f.send(zoom(), overrides)).status).toBe(403);
      }
      for (const command of [
        configure("camera-other"),
        configure("camera-home", { ...source, host: "camera.local" }),
        configure("camera-home", { ...source, host: "8.8.8.8" }),
        configure("camera-home", { ...source, port: 8554 }),
        { ...configure(), gameId: "22222222-2222-4222-8222-222222222222" },
        zoom(1, 2, "camera-other"),
        zoom(-1),
        zoom(1.5),
        zoom(1, 0.9),
        zoom(1, 4.1),
        zoom(1, 1.05),
        { ...zoom(), gameId },
      ]) {
        expect((await f.send(command)).status).toBe(400);
      }
      expect((await f.state()).cameraInputs).toMatchObject({
        "camera-home": { kind: "phone", generation: 0 },
        "camera-away": { kind: "phone", generation: 0 },
      });
      expect(f.start).not.toHaveBeenCalled();
      expect(f.stopPhone).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });

  it("publishes credential-free state and releases only the changed phone role", async () => {
    const f = await fixture();
    try {
      const before = await f.send(configure());
      expect(before.status).toBe(200);
      const beforeText = await before.text();
      expect(beforeText).not.toMatch(
        /private-camera-user|private-camera-password|username|password|rtsp:/,
      );
      expect(f.stopPhone).not.toHaveBeenCalled();
      expect((await f.startProgram()).status).toBe(200);
      const away = await f.send(
        configure("camera-away", { ...source, host: "10.0.0.20" }),
      );
      expect(away.status).toBe(200);
      expect(f.stopPhone.mock.calls).toEqual([["camera-away"]]);
      const response = await away.json();
      expect(response.cameraInputs).toMatchObject({
        "camera-home": {
          kind: "tapo",
          host: source.host,
          stream: "stream2",
          rotation: 90,
        },
        "camera-away": { kind: "tapo", host: "10.0.0.20" },
      });
      expect(JSON.stringify(response)).not.toMatch(
        /private-camera-user|private-camera-password|username|password|rtsp:/,
      );
      expect(
        (await f.send(configure("camera-away", { kind: "phone" }))).status,
      ).toBe(200);
      expect(f.stopPhone).toHaveBeenCalledTimes(1);
      expect((await f.state()).cameraInputs["camera-away"]).toMatchObject({
        kind: "phone",
        host: null,
        stream: null,
        configured: false,
      });
    } finally {
      await f.close();
    }
  });

  it("permits reconnect only for an active Tapo role with unavailable fresh media", async () => {
    const f = await fixture();
    try {
      expect((await f.send(reconnect())).status).toBe(409);
      await f.send(configure());
      expect((await f.send(reconnect())).status).toBe(409);
      expect((await f.startProgram()).status).toBe(200);
      expect((await f.send(reconnect("camera-away"))).status).toBe(409);
      const before = (await f.state()).cameraInputs["camera-home"].generation;
      f.status["camera-home"] = true;
      const fresh = await f.send(reconnect());
      expect(fresh.status).toBe(409);
      expect(await fresh.json()).toMatchObject({
        error: "Camera is already receiving video",
      });
      expect((await f.state()).cameraInputs["camera-home"].generation).toBe(
        before,
      );
      f.status["camera-home"] = false;
      const retried = await f.send(reconnect());
      expect(retried.status).toBe(200);
      expect(
        (await retried.json()).cameraInputs["camera-home"].generation,
      ).toBeGreaterThan(before);
      expect(f.stopPhone).not.toHaveBeenCalled();
      expect((await f.send({ action: "stop-program" })).status).toBe(200);
      expect((await f.send(reconnect())).status).toBe(409);
    } finally {
      await f.close();
    }
  });

  it("rejects source changes and reconnects while program startup owns the busy boundary", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(gate);
    let pending: Promise<Response> | undefined;
    try {
      await f.send(configure());
      pending = f.startProgram();
      await f.startEntered;
      const before = (await f.state()).cameraInputs;
      expect(
        (await f.send(configure("camera-home", { kind: "phone" }))).status,
      ).toBe(409);
      expect((await f.send(reconnect())).status).toBe(409);
      expect((await f.state()).cameraInputs).toEqual(before);
      expect(
        (await f.send(zoom(before["camera-home"].generation))).status,
      ).toBe(409);
      expect(f.stopPhone).not.toHaveBeenCalled();
      release();
      expect((await pending).status).toBe(200);
    } finally {
      release();
      await pending;
      await f.close();
    }
  });
});
