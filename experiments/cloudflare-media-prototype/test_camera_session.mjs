import { test } from "node:test";
import assert from "node:assert/strict";
import { CameraSession } from "./camera-session.js";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));

test("permission granted after Disconnect stops the returned track and never publishes", async () => {
  const permission = deferred(),
    events = [];
  const camera = new CameraSession({
    release: async (id) => events.push(`release:${id}`),
    run: async (a) => {
      await a.claim(Promise.resolve({ connectionId: "old" }));
      await a.acquire(permission.promise, () => events.push("stop-track"));
      events.push("publish");
    },
  });
  const pending = camera.connect();
  await tick();
  await camera.disconnect();
  permission.resolve({});
  await pending;
  assert.deepEqual(events, ["release:old", "stop-track"]);
  assert.equal(camera.current, null);
});

test("a delayed claim is released even when cancellation precedes its response", async () => {
  const claim = deferred(),
    released = [];
  const camera = new CameraSession({
    release: async (id) => released.push(id),
    run: async (a) => {
      await a.claim(claim.promise);
      assert.fail("must not start capture");
    },
  });
  const pending = camera.connect();
  await camera.disconnect();
  claim.resolve({ connectionId: "late" });
  await pending;
  assert.deepEqual(released, ["late"]);
});

test("old negotiation completion cannot receive or clean up a newer camera", async () => {
  const negotiation = deferred(),
    events = [];
  const camera = new CameraSession({
    release: async (id) => events.push(`release:${id}`),
    run: async (a) => {
      await a.claim(Promise.resolve({ connectionId: String(a.sequence) }));
      await a.acquire(Promise.resolve({}), () =>
        events.push(`stop:${a.sequence}`),
      );
      if (a.sequence === 1) await negotiation.promise;
      a.check();
      events.push(`receive:${a.sequence}`);
    },
  });
  const old = camera.connect();
  await tick();
  await camera.connect();
  negotiation.resolve();
  await old;
  assert.equal(camera.current.sequence, 2);
  assert.deepEqual(events, ["stop:1", "release:1", "receive:2"]);
  await camera.disconnect();
});

test("Disconnect clears retry timers and an already queued stale callback cannot restart", async () => {
  let callback,
    cancelled = 0,
    runs = 0;
  const camera = new CameraSession({
    release: async () => {},
    run: async () => {
      runs++;
    },
    schedule: (fn) => {
      callback = fn;
      return 7;
    },
    unschedule: (id) => {
      assert.equal(id, 7);
      cancelled++;
    },
  });
  await camera.connect();
  camera.reconnect(camera.current);
  await camera.disconnect();
  callback();
  await tick();
  assert.equal(cancelled, 1);
  assert.equal(runs, 1);
  assert.equal(camera.current, null);
});

test("a delayed wake lock is released after cancellation", async () => {
  const wake = deferred();
  let releases = 0;
  const camera = new CameraSession({
    release: async () => {},
    run: async (a) => {
      await a.acquire(wake.promise, (lock) => lock.release());
    },
  });
  const pending = camera.connect();
  await camera.disconnect();
  wake.resolve({
    release: () => {
      releases++;
    },
  });
  await pending;
  assert.equal(releases, 1);
});

test("a failed attempt releases its lease, stops resources, and restores controls", async () => {
  const changes = [],
    errors = [],
    released = [];
  let stops = 0;
  const camera = new CameraSession({
    release: async (id) => released.push(id),
    onChange: (v) => changes.push(v),
    onError: (e) => errors.push(e.message),
    run: async (a) => {
      await a.claim(Promise.resolve({ connectionId: "failure" }));
      await a.acquire(Promise.resolve({}), () => {
        stops++;
      });
      throw new Error("negotiation failed");
    },
  });
  await camera.connect();
  assert.equal(stops, 1);
  assert.deepEqual(released, ["failure"]);
  assert.deepEqual(errors, ["negotiation failed"]);
  assert.equal(changes.at(-1), false);
});
