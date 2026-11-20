import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  child: undefined as undefined | FakeChild,
}));

class FakeChild extends EventEmitter {
  pid = 4242;
  stdin = new PassThrough();
  stdout = new PassThrough();
  kill = vi.fn(() => {
    this.emit("error", new Error("kill transport failed"));
    return false;
  });
}

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new FakeChild();
    mocked.child = child;
    queueMicrotask(() => child.stdout.end("READY\n"));
    return child;
  }),
}));

import { startM4StudioRecorder } from "./m4-studio-recorder";

afterEach(() => vi.useRealTimers());

describe.skipIf(process.platform !== "win32")("M4 recorder lifecycle", () => {
  it("does not treat a kill error from a started child as an exit", async () => {
    vi.useFakeTimers();
    const recorder = await startM4StudioRecorder({
      executable: "C:\\recorder.exe",
      runtime: "C:\\runtime",
      recording: "C:\\recording.mkv",
    });
    const child = mocked.child!;
    let closed = false;
    void recorder.closed.then(() => (closed = true));
    const stopping = recorder.stop();
    const stopped = stopping.then(
      () => false,
      () => true,
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect(child.kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(stopped).resolves.toBe(true);
    expect(closed).toBe(false);
    child.emit("exit", 0);
    await expect(recorder.closed).resolves.toEqual({ finalized: true });
  });
});
