import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./assets/client.js", import.meta.url),
  "utf8",
);
function harness() {
  const elements = new Map();
  let resolveCamera;
  const evidence = { rooms: 0, stopped: 0, published: 0 };
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id))
          elements.set(id, { value: "", load() {}, removeAttribute() {} });
        return elements.get(id);
      },
    },
    location: { hash: "", pathname: "/" },
    history: { replaceState() {} },
    navigator: {},
    window: { addEventListener() {} },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    fetch: async () => ({
      ok: true,
      json: async () => ({
        url: "wss://test.invalid",
        token: "test-only",
        fps: 60,
      }),
    }),
    LivekitClient: {
      Room: class {
        constructor() {
          evidence.rooms++;
          this.localParticipant = {
            publishTrack: async () => {
              evidence.published++;
            },
          };
        }
        async connect() {}
        async disconnect() {}
        on() {}
      },
      createLocalVideoTrack: () =>
        new Promise((resolve) => {
          resolveCamera = resolve;
        }),
      Track: { Source: { Camera: "camera" } },
      RoomEvent: {},
    },
  });
  vm.runInContext(source, context);
  return {
    context,
    evidence,
    resolve() {
      resolveCamera({
        stop() {
          evidence.stopped++;
        },
        detach() {},
        attach() {},
        mediaStreamTrack: {
          getSettings() {
            return {};
          },
        },
      });
    },
  };
}

test("disconnect during camera permission prevents late capture from being published", async () => {
  const h = harness();
  const connecting = vm.runInContext("connect('home')", h.context);
  await new Promise((resolve) => setImmediate(resolve));
  await vm.runInContext("disconnect()", h.context);
  h.resolve();
  await assert.rejects(connecting, /cancelled/);
  assert.equal(h.evidence.published, 0);
  assert.equal(h.evidence.stopped, 1);
});

test("two rapid camera choices cannot open two capture sessions", async () => {
  const h = harness();
  const first = vm.runInContext("connect('home')", h.context);
  await new Promise((resolve) => setImmediate(resolve));
  await vm.runInContext("connect('away')", h.context);
  assert.equal(h.evidence.rooms, 1);
  await vm.runInContext("disconnect()", h.context);
  h.resolve();
  await assert.rejects(first, /cancelled/);
});
