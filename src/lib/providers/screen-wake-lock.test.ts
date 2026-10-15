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
  return Object.assign(new EventTarget(), {
    released: false,
    release: vi.fn().mockResolvedValue(undefined),
  }) as unknown as WakeLockSentinel;
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

  it("requests only while visible and does not duplicate a held lock", async () => {
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

  it("reacquires after multiple background/foreground cycles", async () => {
    const acquired = [sentinel(), sentinel(), sentinel()];
    const request = vi
      .fn()
      .mockResolvedValueOnce(acquired[0])
      .mockResolvedValueOnce(acquired[1])
      .mockResolvedValueOnce(acquired[2]);
    const visiblePage = page();
    const available = vi.fn();
    const lock = new OptionalScreenWakeLock(
      { wakeLock: { request } } as unknown as Navigator,
      visiblePage,
      vi.fn(),
      available,
    );
    lock.start();
    await vi.waitFor(() => expect(available).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 2; index++) {
      visiblePage.becomeHidden();
      Object.assign(acquired[index], { released: true });
      acquired[index].dispatchEvent(new Event("release"));
      expect(request).toHaveBeenCalledTimes(index + 1);
      visiblePage.becomeVisible();
      visiblePage.becomeVisible();
      await vi.waitFor(() =>
        expect(available).toHaveBeenCalledTimes(index + 2),
      );
      expect(request).toHaveBeenCalledTimes(index + 2);
    }
    await lock.release();
  });

  it("bounds automatic recovery from a visible system release", async () => {
    const acquired = [sentinel(), sentinel()];
    const request = vi
      .fn()
      .mockResolvedValueOnce(acquired[0])
      .mockResolvedValueOnce(acquired[1]);
    const unavailable = vi.fn();
    const available = vi.fn();
    const lock = new OptionalScreenWakeLock(
      { wakeLock: { request } } as unknown as Navigator,
      page(),
      unavailable,
      available,
    );
    lock.start();
    await vi.waitFor(() => expect(available).toHaveBeenCalledTimes(1));
    acquired[0].dispatchEvent(new Event("release"));
    await vi.waitFor(() => expect(available).toHaveBeenCalledTimes(2));
    acquired[1].dispatchEvent(new Event("release"));
    expect(unavailable).toHaveBeenCalledWith(screenWakeUnavailableMessage);
    expect(request).toHaveBeenCalledTimes(2);
    await lock.release();
  });

  it("releases a pending acquisition after page cleanup", async () => {
    const acquired = sentinel();
    let grant!: (value: WakeLockSentinel) => void;
    const request = vi.fn(
      () =>
        new Promise<WakeLockSentinel>((resolve) => {
          grant = resolve;
        }),
    );
    const lock = new OptionalScreenWakeLock(
      { wakeLock: { request } } as unknown as Navigator,
      page(),
      vi.fn(),
    );
    lock.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const release = lock.release();
    grant(acquired);
    await release;
    expect(acquired.release).toHaveBeenCalledOnce();
  });

  it("releases a successfully acquired wake lock during page cleanup", async () => {
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
  it("contains a browser release failure during page cleanup", async () => {
    const acquired = sentinel();
    (acquired.release as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("browser already released"),
    );
    const request = vi.fn().mockResolvedValue(acquired);
    const lock = new OptionalScreenWakeLock(
      { wakeLock: { request } } as unknown as Navigator,
      page(),
      vi.fn(),
    );
    lock.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await expect(lock.release()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledOnce();
  });
});
