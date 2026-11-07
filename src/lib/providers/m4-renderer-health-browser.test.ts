import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startM4RendererHeartbeat,
  type M4RendererHeartbeat,
} from "./m4-renderer-health-browser";

let callbacks: Map<number, FrameRequestCallback>;
let nextFrame: number;
let visibility: "visible" | "hidden";
let marker: {
  style: { cssText: string; backgroundColor: string };
  setAttribute: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};
const documentMock = (instance?: string) => ({
  querySelector: () => (instance ? { content: instance } : null),
  get visibilityState() {
    return visibility;
  },
  createElement: () => marker,
  body: { appendChild: vi.fn() },
});
beforeEach(() => {
  vi.useFakeTimers();
  callbacks = new Map();
  nextFrame = 0;
  visibility = "visible";
  vi.stubGlobal("crypto", {
    randomUUID: () => "d7c68bb3-9184-4c7e-9d7b-354b572a8565",
  });
  marker = {
    style: { cssText: "", backgroundColor: "" },
    setAttribute: vi.fn(),
    remove: vi.fn(),
  };
  vi.stubGlobal("document", documentMock());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const paint = (at = 0) => {
  const entries = [...callbacks];
  callbacks.clear();
  for (const [, callback] of entries) callback(at);
};

describe("renderer paint heartbeat", () => {
  it("paints a contained corner marker every half second and removes it on cleanup", () => {
    const stop = startM4RendererHeartbeat(async () => {});
    expect(marker.setAttribute).toHaveBeenCalledWith("aria-hidden", "true");
    expect(marker.style.cssText).toContain("width:12px;height:12px");
    expect(marker.style.cssText).toContain("right:0;bottom:0");
    expect(marker.style.cssText).toContain("pointer-events:none");
    paint(0);
    paint(499);
    expect(marker.style.backgroundColor).toBe("rgb(8, 8, 8)");
    paint(500);
    expect(marker.style.backgroundColor).toBe("rgb(40, 40, 40)");
    paint(1000);
    expect(marker.style.backgroundColor).toBe("rgb(8, 8, 8)");
    stop();
    expect(marker.remove).toHaveBeenCalledOnce();
  });
  it("uses the bridge document epoch instead of generating a new owner", async () => {
    vi.stubGlobal(
      "document",
      documentMock("28d5ebf5-86c3-4122-bf6b-4f26a4bdf6be"),
    );
    const send = vi.fn(async (_body: M4RendererHeartbeat) => {});
    const stop = startM4RendererHeartbeat(send);
    expect(send.mock.calls[0][0].instance).toBe(
      "28d5ebf5-86c3-4122-bf6b-4f26a4bdf6be",
    );
    stop();
  });
  it("reports advancing paint independently and exposes hidden/stalled paint without inventing frames", async () => {
    const messages: M4RendererHeartbeat[] = [];
    const stop = startM4RendererHeartbeat(async (body) => {
      messages.push(body);
    });
    await vi.advanceTimersByTimeAsync(0);
    paint();
    paint();
    paint();
    await vi.advanceTimersByTimeAsync(1000);
    expect(messages.map((body) => body.frames)).toEqual([0, 3]);
    visibility = "hidden";
    await vi.advanceTimersByTimeAsync(2000);
    expect(messages.at(-1)).toEqual({
      action: "renderer-heartbeat",
      instance: "d7c68bb3-9184-4c7e-9d7b-354b572a8565",
      frames: 3,
      visibility: "hidden",
    });
    visibility = "visible";
    paint();
    await vi.advanceTimersByTimeAsync(1000);
    expect(messages.at(-1)?.frames).toBe(4);
    expect(
      messages.every(
        (body) =>
          Object.keys(body).sort().join() ===
          "action,frames,instance,visibility",
      ),
    ).toBe(true);
    stop();
    expect(callbacks.size).toBe(0);
    const count = messages.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(messages).toHaveLength(count);
  });
  it("bounds stuck reports, retries serially, and aborts outstanding work on cleanup", async () => {
    let active = 0,
      maxActive = 0;
    const signals: AbortSignal[] = [];
    const stop = startM4RendererHeartbeat((_body, signal) => {
      signals.push(signal);
      active++;
      maxActive = Math.max(active, maxActive);
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            active--;
            reject(new Error("aborted"));
          },
          { once: true },
        ),
      );
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(signals[0].aborted).toBe(true);
    expect(active).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(signals).toHaveLength(2);
    expect(maxActive).toBe(1);
    stop();
    expect(signals[1].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(signals).toHaveLength(2);
    expect(callbacks.size).toBe(0);
  });
});
