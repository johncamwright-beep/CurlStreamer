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

function browser({ permission, offer } = {}) {
  const requests = [],
    tracks = [],
    peers = [],
    nodes = new Map(),
    storage = new Map([["labPageAccess", "page-one"]]);
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
    setInterval: () => 1,
    clearInterval() {},
    document: { getElementById: node },
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
