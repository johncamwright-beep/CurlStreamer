import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createM4IpCameraManager } from "./m4-ip-camera";
import { createM4ProgramBridge } from "./m4-program-bridge";
import { StudioTransportUnavailable } from "./studio-transport-error";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
async function setup(input?: unknown) {
  let now = Date.now();
  const children: ChildProcessWithoutNullStreams[] = [];
  const manager = createM4IpCameraManager({
    helperAvailable: () => true,
    now: () => now,
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null,
        signalCode: null,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;
      child.stdin.on("finish", () => {
        Object.defineProperty(child, "exitCode", { value: 0 });
        child.emit("close", 0);
      });
      children.push(child);
      return child;
    }) as never,
  });
  manager.configure(
    "camera-home",
    input ?? {
      kind: "tapo",
      host: "192.168.1.30",
      username: "local-user",
      password: "private-secret",
      port: 554,
      stream: "stream1",
      rotation: 90,
    },
  );
  manager.connect("camera-home");
  await manager.start();
  const jpeg = await sharp({
    create: { width: 16, height: 24, channels: 3, background: "red" },
  })
    .jpeg()
    .toBuffer();
  const send = (type: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32LE(payload.length, 4);
    (children.at(-1)!.stdout as PassThrough).write(
      Buffer.concat([header, payload]),
    );
  };
  send("JPEG", jpeg);
  const client = { readGame: vi.fn(), action: vi.fn(), close: vi.fn() };
  const realtime = {
    connect: vi.fn(),
    drain: vi.fn(),
    close: vi.fn(async () => {}),
    stopRole: vi.fn(async () => {}),
  };
  const bridge = await createM4ProgramBridge(client, realtime, {
    directory: ".",
    cameraInputs: manager,
  });
  closers.push(async () => {
    await bridge.close();
    await manager.close();
  });
  const page = await fetch(bridge.rendererUrl);
  const rendererInstance = (await page.text()).match(
    /name="m4-renderer-instance" content="([a-f0-9-]+)"/,
  )![1];
  const cookie = page.headers.get("set-cookie")!.split(";")[0];
  const headers = {
    cookie,
    origin: bridge.address,
    "content-type": "application/json",
  };
  const generation = manager.snapshot("camera-home").generation;
  const path = `/ip-camera/camera-home/frame?generation=${generation}&after=0`;
  return {
    manager,
    bridge,
    client,
    realtime,
    jpeg,
    send,
    headers,
    generation,
    rendererInstance,
    path,
    advance: () => {
      now += 6000;
    },
  };
}
describe("local phone and Tapo program integration", () => {
  it("receives a generic RTSP camera without exposing custom path, query or credentials", async () => {
    const { manager, bridge, headers, path, jpeg, realtime } = await setup({
      kind: "rtsp",
      host: "192.168.1.30",
      port: 8554,
      path: "/live?key=private-query",
      username: "local-user",
      password: "private-secret",
      rotation: 0,
    });
    const metadata = await (
      await fetch(bridge.address + "/camera-inputs", { headers })
    ).text();
    expect(metadata).toContain('"kind":"rtsp"');
    expect(metadata).not.toMatch(
      /private-query|private-secret|local-user|8554|192\.168\.1\.30|username|password|path/,
    );
    expect(
      Buffer.from(
        await (await fetch(bridge.address + path, { headers })).arrayBuffer(),
      ),
    ).toEqual(jpeg);
    expect(
      (
        await fetch(bridge.address + "/camera", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "connect",
            cameraRole: "camera-home",
          }),
        })
      ).status,
    ).toBe(410);
    expect(realtime.connect).not.toHaveBeenCalled();
    manager.configure("camera-home", { kind: "phone" });
    expect((await fetch(bridge.address + path, { headers })).status).toBe(409);
  });
  it("keeps secrets local, restricts frames to the renderer, and requires fresh current-generation frame proof", async () => {
    const {
      manager,
      bridge,
      jpeg,
      headers,
      generation,
      rendererInstance,
      path,
      advance,
    } = await setup();
    const read = (path: string, custom = headers) =>
      fetch(bridge.address + path, { headers: custom });
    const metadata = await (await read("/camera-inputs")).text();
    expect(metadata).toContain('"kind":"tapo"');
    expect(metadata).toContain('"kind":"phone"');
    expect(metadata).not.toMatch(/private-secret|local-user|password|username/);
    expect((await fetch(bridge.address + path)).status).toBe(403);
    expect(
      (
        await read(path, {
          ...headers,
          cookie: "",
          authorization: bridge.authorization,
        } as never)
      ).status,
    ).toBe(403);
    expect(
      (await read(path, { ...headers, origin: "https://unrelated.invalid" }))
        .status,
    ).toBe(403);
    expect(Buffer.from(await (await read(path)).arrayBuffer())).toEqual(jpeg);
    const observe = (sourceGeneration: number, frames = 1) =>
      fetch(bridge.address + "/camera", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "observe",
          rendererInstance,
          cameraRole: "camera-home",
          frames,
          verified: true,
          sourceGeneration,
        }),
      });
    expect((await observe(generation + 1)).status).toBe(409);
    expect((await observe(generation, 999)).status).toBe(409);
    expect((await observe(generation)).status).toBe(200);
    expect(bridge.cameraStatus()["camera-home"]).toBe(true);
    expect((await read(path.replace("after=0", "after=1"))).status).toBe(204);
    advance();
    expect(bridge.cameraStatus()["camera-home"]).toBe(false);
    manager.configure("camera-home", { kind: "phone" });
    expect((await read(path)).status).toBe(409);
    expect(bridge.cameraStatus()["camera-home"]).toBe(false);
  });
  it("converts bounded camera PCM and discards meters from an old source generation", async () => {
    const { manager, bridge, send, headers, generation, rendererInstance } =
      await setup();
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(16384);
    pcm.writeInt16LE(-16384, 2);
    send("PCMA", pcm);
    const response = await fetch(
      bridge.address +
        `/ip-camera/camera-home/audio?generation=${generation}&after=0`,
      { headers },
    );
    const floats = Buffer.from(await response.arrayBuffer());
    expect(floats.readFloatLE()).toBe(0.5);
    expect(floats.readFloatLE(4)).toBe(-0.5);
    const observe = () =>
      fetch(bridge.address + "/camera", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "audio-observe",
          rendererInstance,
          cameraRole: "camera-home",
          receiving: true,
          peak: 0.5,
          rms: 0.2,
          sourceGeneration: generation,
        }),
      });
    expect((await observe()).status).toBe(200);
    expect(bridge.audioStatus()["camera-home"].receiving).toBe(true);
    manager.configure("camera-home", { kind: "phone" });
    expect((await observe()).status).toBe(409);
    expect(bridge.audioStatus()["camera-home"].receiving).toBe(false);
  });
  it("retains video through a temporary service outage and revokes both inputs after terminal game authority loss", async () => {
    const { manager, bridge, client, realtime, headers, path } = await setup();
    client.readGame
      .mockRejectedValueOnce(new StudioTransportUnavailable())
      .mockRejectedValueOnce(Error("authority ended"));
    const read = (path: string) => fetch(bridge.address + path, { headers });
    expect((await read("/program")).status).toBe(503);
    expect((await read(path)).status).toBe(200);
    expect((await read("/program")).status).toBe(409);
    expect((await read(path)).status).toBe(403);
    expect(manager.latestFrame("camera-home")).toBeUndefined();
    expect(bridge.cameraStatus()["camera-home"]).toBe(false);
    expect(realtime.close).toHaveBeenCalledOnce();
  });
});
