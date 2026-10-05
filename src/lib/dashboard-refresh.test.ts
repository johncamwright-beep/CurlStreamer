import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DashboardRefreshQueue,
  announceGameCompletion,
  dashboardCompletionEvent,
  dashboardCompletionStorage,
  isCompletionNotice,
} from "./dashboard-refresh";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("coalesces mount, focus and duplicate completion notices without polling", () => {
  const refresh = vi.fn();
  const queue = new DashboardRefreshQueue(refresh, () => true);
  for (let i = 0; i < 20; i++) queue.request();
  vi.advanceTimersByTime(199);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  queue.dispose();
});

it("defers hidden or pending refreshes and resumes once when ready", () => {
  let ready = false;
  const refresh = vi.fn();
  const queue = new DashboardRefreshQueue(refresh, () => ready);
  queue.request();
  vi.advanceTimersByTime(60_000);
  expect(refresh).not.toHaveBeenCalled();
  ready = true;
  queue.resume();
  ready = false;
  vi.advanceTimersByTime(200);
  expect(refresh).not.toHaveBeenCalled();
  ready = true;
  queue.resume();
  vi.advanceTimersByTime(200);
  expect(refresh).toHaveBeenCalledTimes(1);
  queue.dispose();
});

it("bounds refresh bursts and retires scheduled work on navigation", () => {
  const refresh = vi.fn();
  const queue = new DashboardRefreshQueue(refresh, () => true);
  queue.request();
  vi.advanceTimersByTime(200);
  queue.request();
  vi.advanceTimersByTime(999);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  queue.request();
  queue.dispose();
  vi.advanceTimersByTime(60_000);
  queue.request();
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("retains the same-tab notice when browser channel and storage are unavailable", () => {
  const target = new EventTarget();
  const listener = vi.fn();
  target.addEventListener(dashboardCompletionEvent, listener);
  vi.stubGlobal("window", target);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("localStorage", {
    setItem: () => {
      throw new Error("unavailable");
    },
  });
  expect(() => announceGameCompletion("game-id")).not.toThrow();
  expect(listener).toHaveBeenCalledTimes(1);
  expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
    type: "game-completed",
    gameId: "game-id",
  });
});

it("publishes only the game identity and closes the completion channel", () => {
  const postMessage = vi.fn();
  const close = vi.fn();
  const setItem = vi.fn();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage = postMessage;
      close = close;
    },
  );
  vi.stubGlobal("localStorage", { setItem });
  announceGameCompletion("game-id");
  expect(postMessage).toHaveBeenCalledWith({
    type: "game-completed",
    gameId: "game-id",
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(setItem.mock.calls[0][0]).toBe(dashboardCompletionStorage);
  expect(isCompletionNotice(JSON.parse(setItem.mock.calls[0][1]))).toBe(true);
});

it("ignores malformed and unrelated cross-tab notices", () => {
  for (const notice of [
    null,
    "game-completed",
    {},
    { type: "other", gameId: "id" },
    { type: "game-completed", gameId: "" },
  ])
    expect(isCompletionNotice(notice)).toBe(false);
});
