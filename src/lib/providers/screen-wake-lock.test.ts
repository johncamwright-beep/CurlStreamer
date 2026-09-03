import { describe, expect, it, vi } from "vitest";
import {
  OptionalScreenWakeLock,
  screenWakeUnavailableMessage,
} from "./screen-wake-lock";

function page(visibilityState: DocumentVisibilityState = "visible") {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  return {
    visibilityState,
    addEventListener: vi.fn(
      (_name: string, listener: EventListenerOrEventListenerObject) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_name: string, listener: EventListenerOrEventListenerObject) =>
        listeners.delete(listener),
    ),
    becomeHidden() {
      this.visibilityState = "hidden";
    },
    becomeVisible() {
      this.visibilityState = "visible";
      for (const listener of listeners) {
        if (typeof listener === "function")
          listener(new Event("visibilitychange"));
        else listener.handleEvent(new Event("visibilitychange"));
      }
    },
  };
}

function sentinel() {
  return {
    released: false,
    release: vi.fn().mockResolvedValue(undefined),
  } as unknown as WakeLockSentinel;
}

describe("optional screen wake lock", () => {
  it("turns a wake-lock NotAllowedError into a warning rather than a failure", async () => {
    const onUnavailable = vi.fn();
    const lock = new OptionalScreenWakeLock(
      {
        wakeLock: {
          request: vi
            .fn()
            .mockRejectedValue(new DOMException("denied", "NotAllowedError")),
        },
      } as unknown as Navigator,
      page(),
      onUnavailable,
    );

    expect(() => lock.start()).not.toThrow();
    await vi.waitFor(() =>
      expect(onUnavailable).toHaveBeenCalledWith(screenWakeUnavailableMessage),
    );
  });

  it("also contains a synchronous wake-lock request failure", async () => {
    const onUnavailable = vi.fn();
    const lock = new OptionalScreenWakeLock(
      {
        wakeLock: {
          request: vi.fn(() => {
            throw new DOMException("denied", "NotAllowedError");
          }),
        },
      } as unknown as Navigator,
      page(),
      onUnavailable,
    );

    expect(() => lock.start()).not.toThrow();
    await vi.waitFor(() =>
      expect(onUnavailable).toHaveBeenCalledWith(screenWakeUnavailableMessage),
    );
  });

  it("has no camera-cleanup or LiveKit-disconnection side effects on rejection", async () => {
    const cameraStop = vi.fn();
    const roomDisconnect = vi.fn();
    const lock = new OptionalScreenWakeLock(
      {
        wakeLock: { request: vi.fn().mockRejectedValue(new Error("no lock")) },
      } as unknown as Navigator,
      page(),
      vi.fn(),
    );

    lock.start();
    await vi.waitFor(() => expect(cameraStop).not.toHaveBeenCalled());
    expect(roomDisconnect).not.toHaveBeenCalled();
  });

  it("allows broadcasting to continue when wake lock is unsupported", () => {
    const onUnavailable = vi.fn();
    const lock = new OptionalScreenWakeLock(
      {} as unknown as Navigator,
      page(),
      onUnavailable,
    );

    expect(() => lock.start()).not.toThrow();
    expect(onUnavailable).toHaveBeenCalledWith(screenWakeUnavailableMessage);
  });

  it("requests only while visible and retries once after visibility returns", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(sentinel());
    const visiblePage = page();
    const lock = new OptionalScreenWakeLock(
      { wakeLock: { request } } as unknown as Navigator,
      visiblePage,
      vi.fn(),
    );

    lock.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    visiblePage.becomeHidden();
    visiblePage.becomeVisible();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    visiblePage.becomeHidden();
    visiblePage.becomeVisible();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("releases a successfully acquired wake lock during disconnect cleanup", async () => {
    const acquired = sentinel();
    const lock = new OptionalScreenWakeLock(
      {
        wakeLock: { request: vi.fn().mockResolvedValue(acquired) },
      } as unknown as Navigator,
      page(),
      vi.fn(),
    );

    lock.start();
    await vi.waitFor(() =>
      expect(
        (acquired.release as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(0),
    );
    await lock.release();

    expect(acquired.release).toHaveBeenCalledOnce();
  });
});
