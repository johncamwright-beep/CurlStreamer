import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CameraSession } from "./camera-session.js";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));

function browser({ permission, offer, reply, stored = [] } = {}) {
  const requests = [],
    tracks = [],
    peers = [],
    nodes = new Map(),
    storage = new Map([["labPageAccess", "page-one"], ...stored]),
    intervals = new Map();
  let intervalNumber = 0;
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        textContent: "",
        pause() {},
        load() {},
        removeAttribute() {},
      });
    return nodes.get(id);
  };
  class Peer {
    constructor() {
      this.number = peers.length;
      peers.push(this);
      this.iceGatheringState = "complete";
      this.connectionState = "connected";
      this.closed = false;
    }
    addTransceiver() {
      return {
        mid: "0",
        setCodecPreferences() {},
        sender: { getParameters: () => ({}), setParameters: async () => {} },
      };
    }
    async createOffer() {
      if (this.number === 0 && offer) return offer.promise;
      return { type: "offer", sdp: "v=0\r\n" };
    }
    async setLocalDescription(value) {
      this.localDescription = value;
    }
    async setRemoteDescription() {}
    async getStats() {
      return new Map([
        [
          "video",
          {
            type: "outbound-rtp",
            kind: "video",
            packetsSent: 1,
            framesEncoded: 1,
          },
        ],
      ]);
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.closed = true;
    }
  }
  const makeStream = () => {
    const track = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
      getSettings: () => ({ width: 720, height: 1280, frameRate: 60 }),
    };
    tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  const context = vm.createContext({
    CameraSession,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval: (callback) => {
      intervals.set(++intervalNumber, callback);
      return intervalNumber;
    },
    clearInterval: (id) => intervals.delete(id),
    document: { getElementById: node, addEventListener() {} },
    sessionStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    location: { hash: "", pathname: "/" },
    history: { replaceState() {} },
    window: { addEventListener() {} },
    navigator: {
      mediaDevices: {
        getUserMedia: () =>
          permission ? permission.promise : Promise.resolve(makeStream()),
      },
    },
    RTCPeerConnection: Peer,
    RTCRtpSender: {
      getCapabilities: () => ({
        codecs: [
          { mimeType: "video/H264", sdpFmtpLine: "packetization-mode=1" },
        ],
      }),
    },
    fetch: async (path, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ path, body, headers: options.headers });
      if (reply) {
        const response = await reply(path, body);
        if (response) return response;
      }
      const value =
        path === "/status"
          ? {
              role: "camera1",
              ended: false,
              started: false,
              remaining: 600,
              cameras: {},
              encodedFrames: 0,
              encoderFps: 0,
            }
          : path === "/camera-claim"
            ? { connectionId: `lease-${body.sequence}` }
            : path === "/attach"
              ? { sessionDescription: { type: "answer", sdp: "v=0\r\n" } }
              : {};
      return { ok: true, json: async () => value };
    },
  });
  vm.runInContext(
    fs.readFileSync(new URL("./client.js", import.meta.url), "utf8"),
    context,
  );
  return {
    context,
    intervals,
    storage,
    requests,
    tracks,
    peers,
    makeStream,
    node,
    run: (source) => vm.runInContext(source, context),
  };
}

test("real client does not attach when permission resolves after Disconnect", async () => {
  const permission = deferred(),
    b = browser({ permission });
  await tick();
  const pending = b.run("connect()");
  await tick();
  await b.run("disconnect()");
  permission.resolve(b.makeStream());
  await pending;
  assert.equal(b.tracks[0].stopped, true);
  assert.equal(b.peers.length, 0);
  assert.equal(
    b.requests.some((r) => r.path === "/attach"),
    false,
  );
  assert.equal(
    b.requests.find((r) => r.path === "/disconnect").body.connectionId,
    "lease-1",
  );
});

test("real client stops the peer after delayed negotiation and skips attach", async () => {
  const offer = deferred(),
    b = browser({ offer });
  await tick();
  const pending = b.run("connect()");
  await tick();
  await b.run("disconnect()");
  offer.resolve({ type: "offer", sdp: "v=0\r\n" });
  await pending;
  assert.equal(b.peers[0].closed, true);
  assert.equal(b.tracks[0].stopped, true);
  assert.equal(
    b.requests.some((r) => r.path === "/attach"),
    false,
  );
});

test("real client sends stable page identity and the new lease while stale work finishes", async () => {
  const offer = deferred(),
    b = browser({ offer });
  await tick();
  const old = b.run("connect()");
  await tick();
  await b.run("connect()");
  offer.resolve({ type: "offer", sdp: "v=0\r\n" });
  await old;
  assert.equal(b.peers[0].closed, true);
  assert.equal(b.peers[1].closed, false);
  assert.equal(b.tracks[0].stopped, true);
  assert.equal(b.tracks[1].stopped, false);
  const attach = b.requests.filter((r) => r.path === "/attach");
  assert.equal(attach.length, 1);
  assert.equal(attach[0].body.connectionId, "lease-2");
  for (const request of b.requests)
    assert.equal(request.headers["X-Lab-Page"], "page-one");
  assert.equal(b.requests.filter((r) => r.path === "/receive").length, 1);
  await b.run("disconnect()");
});

const response = (value, ok = true, status = ok ? 200 : 401) => ({
  ok,
  status,
  json: async () => value,
});
function controlFixture() {
  const state = {
    serverExpired: false,
    delayed: null,
    fail: false,
    resumeFail: false,
    instance: "instance-one",
    started: false,
    ended: false,
    remaining: 600,
    canStart: true,
  };
  const b = browser({
    stored: [
      ["labRole", "control"],
      ["labRecoveryTicket", "offline-control-ticket"],
    ],
    reply: async (path) => {
      if (state.serverExpired)
        return response({ detail: "Private link expired" }, false, 410);
      if (path === "/resume-control") {
        if (state.resumeFail)
          return response({ detail: "Expired private link" }, false);
        state.canStart = false;
        return response({
          role: "control",
          pageAccess: "page-resumed",
          canStart: false,
          expiresAt: Math.floor(Date.now() / 1000) + 600,
        });
      }
      if (path === "/status" && state.delayed) return state.delayed.promise;
      if (path === "/status")
        return state.fail
          ? response({ detail: "Page access lost" }, false)
          : response({
              role: "control",
              cameras: {},
              encodedFrames: 0,
              encoderFps: 0,
              message: "Fixture status",
              ...state,
            });
    },
  });
  return { b, state };
}
test("lost control stops polls and mutations; explicit Resume observes a phone-started replacement only", async () => {
  const { b, state } = controlFixture();
  await tick();
  assert.equal(b.intervals.size, 1);
  state.fail = true;
  await b.run("poll()");
  assert.equal(b.intervals.size, 0);
  for (const id of ["start", "stop", "score"])
    assert.equal(b.node(id).disabled, true);
  assert.equal(b.node("resume").hidden, false);
  const count = b.requests.length;
  await b.run("poll()");
  assert.equal(b.requests.length, count);
  state.fail = false;
  state.instance = "instance-two";
  state.started = true;
  state.remaining = 321;
  await b.run("resumeControl()");
  assert.deepEqual(
    b.requests.slice(count).map((r) => r.path),
    ["/resume-control", "/status"],
  );
  assert.equal(b.intervals.size, 1);
  assert.equal(b.node("start").disabled, true);
  assert.equal(b.node("stop").disabled, false);
  assert.match(b.node("connection").textContent, /Server changed/);
  assert.equal(b.run("ended"), false);
  assert.equal(b.storage.get("labPageAccess"), "page-resumed");
});
test("failed Resume does not poll or replay writes; expired local capability does not make a request", async () => {
  const { b, state } = controlFixture();
  await tick();
  state.fail = true;
  await b.run("poll()");
  state.resumeFail = true;
  const count = b.requests.length;
  await b.run("resumeControl()");
  assert.deepEqual(
    b.requests.slice(count).map((r) => r.path),
    ["/resume-control"],
  );
  assert.equal(b.intervals.size, 0);
  b.run("absoluteExpires = 1");
  const after = b.requests.length;
  await b.run("resumeControl()");
  assert.equal(b.requests.length, after);
  assert.equal(b.node("resume").hidden, true);
});
test("idle and hidden control pause without a wakeup; ended state cannot Resume", async () => {
  const { b, state } = controlFixture();
  await tick();
  b.run("monitorUntil = Date.now() - 1");
  const count = b.requests.length;
  await b.run("poll()");
  assert.equal(b.requests.length, count);
  assert.equal(b.intervals.size, 0);
  await b.run("resumeControl()");
  assert.equal(b.node("start").disabled, true);
  assert.equal(b.node("stop").disabled, true);
  b.run("document.hidden = true");
  const resumed = b.requests.length;
  await b.run("poll()");
  assert.equal(b.requests.length, resumed);
  assert.equal(b.intervals.size, 0);
  b.run("document.hidden = false");
  state.ended = true;
  await b.run("resumeControl()");
  assert.equal(b.intervals.size, 0);
  assert.equal(b.node("resume").hidden, true);
  const end = b.requests.length;
  await b.run("resumeControl()");
  assert.equal(b.requests.length, end);
});

test("delayed status cannot block or overwrite Resume after control pauses", async () => {
  const { b, state } = controlFixture();
  await tick();
  const old = deferred();
  state.delayed = old;
  const stalePoll = b.run("poll()");
  await tick();
  b.run('pauseControl("Hidden control paused")');
  state.delayed = null;
  state.instance = "replacement-instance";
  state.started = true;
  state.remaining = 200;
  await b.run("resumeControl()");
  assert.equal(b.intervals.size, 1);
  assert.match(b.node("remaining").textContent, /3:20/);
  old.resolve(
    response({
      role: "control",
      instance: "old-instance",
      ended: true,
      started: true,
      remaining: 0,
      cameras: {},
      encodedFrames: 0,
      encoderFps: 0,
    }),
  );
  await stalePoll;
  assert.equal(b.intervals.size, 1);
  assert.equal(b.run("ended"), false);
  assert.equal(b.run("lastInstance"), "replacement-instance");
  assert.match(b.node("remaining").textContent, /3:20/);
  await b.run("poll()");
  assert.equal(b.intervals.size, 1);
});

test("server 410 expires control even when the browser deadline has not elapsed", async () => {
  const { b, state } = controlFixture();
  await tick();
  b.run("absoluteExpires = Date.now() / 1000 + 600");
  state.serverExpired = true;
  await b.run("poll()");
  assert.equal(b.intervals.size, 0);
  assert.equal(b.node("resume").hidden, true);
  assert.equal(b.run("ended"), true);
  assert.match(b.node("connection").textContent, /expired/);
  assert.doesNotMatch(b.node("connection").textContent, /Resume/);
  const count = b.requests.length;
  await b.run("resumeControl()");
  assert.equal(b.requests.length, count);
});
