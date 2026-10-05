import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  type ChildProcessWithoutNullStreams,
  type spawn,
} from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createM4IpCameraManager } from "./m4-ip-camera";
import { m4CameraInputSchema } from "../m4-camera-input";

const config = {
  kind: "tapo",
  host: "192.168.1.20",
  username: "camera-user",
  password: "private-password",
  stream: "stream1",
  rotation: 90,
};
const jpeg = Buffer.from("ffd8ffc0000b080002000201011100ffd9", "hex");
function record(type: string, payload: Buffer | string) {
  const body = Buffer.from(payload);
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
function harness(exitOnStop = true) {
  const children: (ChildProcessWithoutNullStreams & {
    secretInput: string;
    stdout: PassThrough;
    stderr: PassThrough;
  })[] = [];
  const spawnMock = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null as string | null,
      secretInput: "",
      kill: vi.fn(() => {
        if (exitOnStop) close();
        return true;
      }),
    });
    function close() {
      if (child.exitCode !== null) return;
      child.exitCode = 0;
      queueMicrotask(() => child.emit("close", 0));
    }
    child.stdin.on("data", (chunk: Buffer) => {
      child.secretInput += chunk.toString();
    });
    child.stdin.on("finish", () => {
      if (exitOnStop) close();
    });
    children.push(child as unknown as (typeof children)[number]);
    return child;
  });
  const manager = createM4IpCameraManager({
    helperPath: "helper.exe",
    runtimePath: "runtime",
    helperAvailable: () => true,
    spawn: spawnMock as unknown as typeof spawn,
  });
  return { manager, children, spawnMock };
}
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("local IP camera manager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends custom endpoints only through private stdin and keeps RTSP snapshots anonymous", async () => {
    const { manager, children, spawnMock } = harness();
    const source = {
      kind: "rtsp",
      host: "192.168.1.30",
      port: 8554,
      path: "/live/video?key=private-query",
      rotation: 270,
    };
    manager.configure("camera-home", source);
    await manager.start();
    expect(JSON.parse(children[0].secretInput)).toEqual({
      version: 2,
      host: source.host,
      port: 8554,
      username: "",
      password: "",
      path: source.path,
      rotation: 270,
    });
    expect(manager.snapshot("camera-home")).toMatchObject({
      kind: "rtsp",
      host: null,
      stream: null,
      rotation: 270,
      configured: true,
    });
    expect(JSON.stringify(manager.snapshot())).not.toMatch(
      /private-query|live\/video|8554|path|username|password/,
    );
    expect(JSON.stringify(spawnMock.mock.calls)).not.toContain("private-query");
    children[0].stdout.write(record("JPEG", jpeg));
    expect(manager.snapshot("camera-home").phase).toBe("streaming");
    await manager.close();
  });

  it("accepts only literal RFC1918 hosts and validates options without exposing credentials", () => {
    for (const host of [
      "127.0.0.1",
      "169.254.1.2",
      "224.1.1.1",
      "8.8.8.8",
      "192.168.01.2",
      "camera.local",
      "192.168.1.2:554",
      "172.32.1.2",
      "10.0.0.256",
      "::1",
    ]) {
      expect(m4CameraInputSchema.safeParse({ ...config, host }).success).toBe(
        false,
      );
    }
    for (const host of [
      "10.1.2.3",
      "172.16.0.2",
      "172.31.255.2",
      "192.168.2.1",
    ])
      expect(m4CameraInputSchema.safeParse({ ...config, host }).success).toBe(
        true,
      );
    const { manager } = harness();
    expect(() =>
      manager.configure("camera-home", {
        ...config,
        host: "bad",
        password: "secret",
      }),
    ).toThrow("invalid_camera_input");
    expect(() =>
      manager.configure("camera-home", { ...config, port: 8554 }),
    ).toThrow("invalid_camera_input");
  });

  it("launches independent roles only when active and sends secrets exclusively over private stdin", async () => {
    const { manager, children, spawnMock } = harness();
    manager.configure("camera-home", config);
    manager.configure("camera-away", {
      ...config,
      host: "10.1.1.20",
      stream: "stream2",
    });
    await settle();
    expect(spawnMock).not.toHaveBeenCalled();
    await manager.start();
    expect(children).toHaveLength(2);
    expect(spawnMock.mock.calls[0]).toMatchObject([
      "helper.exe",
      ["runtime"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        cwd: "runtime",
        env: { Path: expect.stringMatching(/^runtime(?:;|$)/) },
      },
    ]);
    const spawnOptions = (
      spawnMock.mock.calls[0] as unknown as [
        string,
        string[],
        { env: NodeJS.ProcessEnv },
      ]
    )[2];
    expect(
      Object.keys(spawnOptions.env).filter(
        (key) => key.toLowerCase() === "path",
      ),
    ).toEqual(["Path"]);
    expect(
      Object.keys(spawnOptions.env).every((key) =>
        ["Path", "SystemRoot", "TEMP", "TMP", "NODE_ENV"].includes(key),
      ),
    ).toBe(true);
    expect(JSON.stringify(spawnOptions.env)).not.toMatch(
      /private-password|camera-user/,
    );
    expect(JSON.parse(children[0].secretInput)).toEqual({
      version: 1,
      ...config,
      kind: undefined,
      port: 554,
    });
    expect(children[0].stdin.writableEnded).toBe(false);
    children[0].stderr.write(
      "private-password rtsp://camera-user:private-password@host",
    );
    expect(JSON.stringify(manager.snapshot())).not.toMatch(
      /private-password|camera-user|rtsp:/,
    );
    children[0].stdout.write(record("STAT", '{"code":"streaming"}'));
    expect(manager.snapshot("camera-home").phase).toBe("connecting");
    children[0].stdout.write(record("JPEG", jpeg));
    expect(manager.snapshot("camera-home").phase).toBe("streaming");
    expect(manager.snapshot("camera-away").phase).toBe("connecting");
    await manager.stop();
    expect(manager.latestFrame("camera-home")).toBeUndefined();
  });

  it("uses only current advancing frames, bounds PCM, and clears previous generations atomically", async () => {
    const { manager, children } = harness();
    manager.configure("camera-home", config);
    await manager.start();
    const first = children[0];
    const bytes = record("JPEG", jpeg);
    first.stdout.write(bytes.subarray(0, 5));
    first.stdout.write(bytes.subarray(5));
    const initial = manager.latestFrame("camera-home")!;
    first.stdout.write(record("PCMA", Buffer.alloc(9600, 1)));
    first.stdout.write(record("PCMA", Buffer.alloc(9600, 2)));
    expect(manager.takeAudio("camera-home").pcm).toEqual(Buffer.alloc(9600, 2));
    expect(manager.takeAudio("camera-home").pcm.length).toBe(0);
    const copy = manager.latestFrame("camera-home")!;
    copy.jpeg.fill(0);
    expect(manager.latestFrame("camera-home")!.jpeg).toEqual(jpeg);
    manager.reconnect("camera-home");
    expect(manager.latestFrame("camera-home")).toBeUndefined();
    expect(manager.takeAudio("camera-home").generation).toBeGreaterThan(
      initial.generation,
    );
    first.stdout.write(record("JPEG", jpeg));
    expect(manager.latestFrame("camera-home")).toBeUndefined();
    await settle();
    expect(children).toHaveLength(2);
    children[1].stdout.write(record("JPEG", jpeg));
    await vi.advanceTimersByTimeAsync(4999);
    expect(manager.latestFrame("camera-home")).toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(manager.latestFrame("camera-home")).toBeUndefined();
    expect(manager.snapshot("camera-home").errorCode).toBe("stale_frames");
    await manager.stop();
  });

  it.each([
    "unknown",
    "oversized",
    "truncated",
    "bad-jpeg",
    "secret-status",
    "odd-pcm",
  ])("rejects %s native records using fixed errors", async (kind) => {
    const { manager, children } = harness();
    manager.configure("camera-home", config);
    await manager.start();
    const child = children[0];
    if (kind === "unknown")
      child.stdout.write(record("LEAK", "private-password"));
    if (kind === "oversized") {
      const header = record("JPEG", jpeg).subarray(0, 8);
      header.writeUInt32LE(0xffffffff, 4);
      child.stdout.write(header);
    }
    if (kind === "truncated") {
      child.stdout.write(record("JPEG", jpeg).subarray(0, 10));
      child.stdout.end();
    }
    if (kind === "bad-jpeg") child.stdout.write(record("JPEG", "not-jpeg"));
    if (kind === "secret-status")
      child.stdout.write(record("STAT", '{"code":"private-password"}'));
    if (kind === "odd-pcm") child.stdout.write(record("PCMA", Buffer.alloc(3)));
    await settle();
    expect(manager.snapshot("camera-home").errorCode).toBe("invalid_pipe");
    expect(JSON.stringify(manager.snapshot())).not.toContain(
      "private-password",
    );
    expect(manager.latestFrame("camera-home")).toBeUndefined();
    await manager.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(children).toHaveLength(1);
  });

  it("does not retry auth failures until configuration changes, even after a new program lifetime", async () => {
    const { manager, children } = harness();
    manager.configure("camera-home", config);
    await manager.start();
    children[0].stdout.write(record("STAT", '{"code":"auth_failed"}'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(manager.snapshot("camera-home").errorCode).toBe("auth_failed");
    expect(children).toHaveLength(1);
    await manager.stop();
    await manager.start();
    expect(children).toHaveLength(1);
    manager.configure("camera-home", { ...config, password: "new-password" });
    await settle();
    expect(children).toHaveLength(2);
    await manager.close();
    expect(manager.snapshot("camera-home").kind).toBe("phone");
    expect(() => manager.configure("camera-home", config)).toThrow(
      "camera_manager_closed",
    );
  });

  it("backs off transient failures and resets retry delay only after sustained fresh frames", async () => {
    const { manager, children } = harness();
    manager.configure("camera-home", config);
    await manager.start();
    children[0].stdout.write(record("STAT", '{"code":"unavailable"}'));
    await settle();
    await vi.advanceTimersByTimeAsync(499);
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(children).toHaveLength(2);
    children[1].stdout.write(record("STAT", '{"code":"unavailable"}'));
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(children).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(children).toHaveLength(3);
    for (let n = 0; n < 22; n++) {
      children[2].stdout.write(record("JPEG", jpeg));
      await vi.advanceTimersByTimeAsync(500);
    }
    children[2].stdout.write(record("STAT", '{"code":"unavailable"}'));
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(children).toHaveLength(4);
    await manager.stop();
  });

  it("bounds malformed JPEG marker parsing and tolerates diagnostic persistence failures", async () => {
    const manager = createM4IpCameraManager({
      helperAvailable: () => false,
      diagnostic: () => {
        throw Error("logger_failed");
      },
    });
    manager.configure("camera-home", config);
    await manager.start();
    expect(manager.snapshot("camera-home").errorCode).toBe("runtime_missing");
    await manager.close();
    const { manager: live, children } = harness();
    live.configure("camera-home", config);
    await live.start();
    const bad = Buffer.alloc(16, 0xff);
    bad.writeUInt16BE(0xffd8, 0);
    bad.writeUInt16BE(0xffd9, 14);
    expect(() => children[0].stdout.write(record("JPEG", bad))).not.toThrow();
    expect(live.snapshot("camera-home").errorCode).toBe("invalid_pipe");
    await live.stop();
  });

  it("bounds startup hangs and refuses to overlap a helper that does not terminate", async () => {
    const { manager, children } = harness(false);
    manager.configure("camera-home", config);
    await manager.start();
    await vi.advanceTimersByTimeAsync(12000);
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    expect(manager.snapshot("camera-home").phase).toBe("failed");
    await vi.advanceTimersByTimeAsync(60000);
    expect(children).toHaveLength(1);
    await expect(manager.stop()).rejects.toThrow("camera_cleanup_failed");
    await manager.start();
    expect(children).toHaveLength(1);
    await expect(manager.close()).rejects.toThrow("camera_cleanup_failed");
  });

  it("exposes missing runtime with no launch and leaves phone defaults usable", async () => {
    const manager = createM4IpCameraManager({ helperAvailable: () => false });
    expect(manager.snapshot("camera-away")).toMatchObject({
      kind: "phone",
      phase: "idle",
      configured: false,
    });
    manager.configure("camera-home", config);
    await manager.start();
    expect(manager.snapshot("camera-home")).toMatchObject({
      phase: "failed",
      errorCode: "runtime_missing",
    });
    await manager.close();
  });
});
