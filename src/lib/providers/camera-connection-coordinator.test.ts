import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CameraConnectionCoordinator,
  ConnectionFailure,
  type ConnectionAttempt,
} from "./camera-connection-coordinator";

type Handle = { stop: ReturnType<typeof vi.fn> };
function pending() {
  let resolve!: (handle: Handle) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Handle>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const temporary = () => new ConnectionFailure("network_unavailable", true);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("publishes media phase changes without repeating unchanged samples", async () => {
  let attempt!: ConnectionAttempt;
  const onState = vi.fn();
  const coordinator = new CameraConnectionCoordinator({
    connect: async (value) => {
      attempt = value;
      return { stop: vi.fn() };
    },
    onState,
  });
  await coordinator.start();
  attempt.phase("streaming");
  const calls = onState.mock.calls.length;
  attempt.phase("streaming");
  attempt.phase("streaming");
  expect(onState).toHaveBeenCalledTimes(calls);
  attempt.phase("negotiating");
  expect(onState).toHaveBeenCalledTimes(calls + 1);
  coordinator.close();
});

it("reserves the factory synchronously and coalesces starts", async () => {
  const task = pending();
  const connect = vi.fn(() => task.promise);
  const coordinator = new CameraConnectionCoordinator({ connect });
  const first = coordinator.start();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(coordinator.start()).toBe(first);
  task.resolve({ stop: vi.fn() });
  await first;
  await coordinator.start();
  expect(connect).toHaveBeenCalledTimes(1);
  coordinator.close();
});

it("invalidates before release and waits for a failed factory before retrying", async () => {
  const tasks = [pending(), pending()];
  const attempts: ConnectionAttempt[] = [];
  let releasedCurrent: boolean | undefined;
  const connect = vi.fn((attempt: ConnectionAttempt) => {
    attempts.push(attempt);
    return tasks[attempts.length - 1].promise;
  });
  const coordinator = new CameraConnectionCoordinator({
    connect,
    release: () => {
      releasedCurrent = attempts[0].current();
      expect(attempts[0].signal.aborted).toBe(true);
    },
    retryDelays: [100],
  });
  const first = coordinator.start();
  attempts[0].fail(temporary());
  expect(releasedCurrent).toBe(false);
  attempts[0].phase("streaming");
  expect(coordinator.snapshot.phase).toBe("retrying");
  await vi.advanceTimersByTimeAsync(1000);
  expect(connect).toHaveBeenCalledTimes(1);
  const late = { stop: vi.fn() };
  tasks[0].resolve(late);
  await first;
  expect(late.stop).toHaveBeenCalledTimes(1);
  expect(connect).toHaveBeenCalledTimes(2);
  attempts[0].fail(new ConnectionFailure("authority_rejected", false));
  expect(attempts[1].current()).toBe(true);
  tasks[1].resolve({ stop: vi.fn() });
  await coordinator.start();
  coordinator.close();
});

it("coalesces manual replacement while the aborted factory remains pending", async () => {
  const tasks = [pending(), pending()];
  const attempts: ConnectionAttempt[] = [];
  const coordinator = new CameraConnectionCoordinator({
    connect: (attempt) => {
      attempts.push(attempt);
      return tasks[attempts.length - 1].promise;
    },
  });
  const first = coordinator.start();
  const replacement = coordinator.restart();
  expect(coordinator.restart()).toBe(replacement);
  expect(coordinator.start()).toBe(replacement);
  expect(attempts).toHaveLength(1);
  const old = { stop: vi.fn() };
  tasks[0].resolve(old);
  await first;
  expect(old.stop).toHaveBeenCalledTimes(1);
  expect(attempts).toHaveLength(2);
  attempts[0].phase("streaming");
  expect(coordinator.snapshot.phase).toBe("connecting");
  tasks[1].resolve({ stop: vi.fn() });
  await replacement;
  coordinator.close();
});

it("stop cancels queued replacement and stops a late handle; close is terminal", async () => {
  const task = pending();
  const connect = vi.fn(() => task.promise);
  const coordinator = new CameraConnectionCoordinator({ connect });
  const first = coordinator.start();
  const replacement = coordinator.restart();
  coordinator.stop();
  await replacement;
  const handle = { stop: vi.fn() };
  task.resolve(handle);
  await first;
  expect(handle.stop).toHaveBeenCalledTimes(1);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(coordinator.snapshot.phase).toBe("stopped");
  coordinator.close();
  await coordinator.start();
  await coordinator.restart();
  expect(connect).toHaveBeenCalledTimes(1);
});

it("start after stop queues a fresh connection until old capture settles", async () => {
  const tasks = [pending(), pending()];
  let calls = 0;
  const connect = vi.fn(() => tasks[calls++].promise);
  const coordinator = new CameraConnectionCoordinator({ connect });
  const first = coordinator.start();
  coordinator.stop();
  const next = coordinator.start();
  expect(coordinator.start()).toBe(next);
  expect(connect).toHaveBeenCalledTimes(1);
  tasks[0].resolve({ stop: vi.fn() });
  await first;
  expect(connect).toHaveBeenCalledTimes(2);
  tasks[1].resolve({ stop: vi.fn() });
  await next;
  coordinator.close();
});

it.each([
  new Error("unclassified"),
  new ConnectionFailure("authority_rejected", false),
])("blocks nonretryable rejection %s", async (error) => {
  const connect = vi.fn(() => Promise.reject(error));
  const coordinator = new CameraConnectionCoordinator({ connect });
  await coordinator.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(coordinator.snapshot.phase).toBe("blocked");
  expect(connect).toHaveBeenCalledTimes(1);
});

it("checks consent when scheduling and again when a retry becomes due", async () => {
  let permitted = false;
  const connect = vi.fn(() => Promise.reject(temporary()));
  const coordinator = new CameraConnectionCoordinator({
    connect,
    canRetry: () => permitted,
  });
  await coordinator.start();
  expect(coordinator.snapshot.phase).toBe("blocked");
  permitted = true;
  await coordinator.start();
  expect(coordinator.snapshot.phase).toBe("retrying");
  permitted = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(coordinator.snapshot.phase).toBe("blocked");
  expect(connect).toHaveBeenCalledTimes(2);
});

it("caps backoff and resets only after ten seconds of stable streaming", async () => {
  const attempts: ConnectionAttempt[] = [];
  const coordinator = new CameraConnectionCoordinator({
    connect: async (attempt) => {
      attempts.push(attempt);
      return { stop: vi.fn() };
    },
    retryDelays: [100, 200],
  });
  await coordinator.start();
  attempts[0].phase("streaming");
  await vi.advanceTimersByTimeAsync(9999);
  attempts[0].fail(temporary());
  expect(coordinator.snapshot.retryInMs).toBe(100);
  await vi.advanceTimersByTimeAsync(100);
  attempts[1].phase("streaming");
  attempts[1].fail(temporary());
  expect(coordinator.snapshot).toMatchObject({ failures: 2, retryInMs: 200 });
  await vi.advanceTimersByTimeAsync(200);
  attempts[2].fail(temporary());
  expect(coordinator.snapshot).toMatchObject({ failures: 3, retryInMs: 200 });
  await vi.advanceTimersByTimeAsync(200);
  attempts[3].phase("streaming");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(coordinator.snapshot.failures).toBe(0);
  attempts[3].fail(temporary());
  expect(coordinator.snapshot.retryInMs).toBe(100);
  coordinator.close();
});

it("observer and release exceptions cannot interrupt cleanup", async () => {
  let attempt!: ConnectionAttempt;
  const handle = { stop: vi.fn() };
  const coordinator = new CameraConnectionCoordinator({
    connect: async (value) => {
      attempt = value;
      return handle;
    },
    onState: () => {
      throw Error("observer");
    },
    release: () => {
      throw Error("release");
    },
  });
  await coordinator.start();
  expect(() => coordinator.stop()).not.toThrow();
  expect(attempt.current()).toBe(false);
  expect(attempt.signal.aborted).toBe(true);
  expect(handle.stop).toHaveBeenCalledTimes(1);
});
