"use strict";
const $ = (id) => document.getElementById(id);
let role = null,
  hls = null,
  previewGeneration = -1,
  ended = false,
  connecting = false,
  timer = null;
let pageAccess = sessionStorage.getItem("labPageAccess") || "";
async function api(path, body, signal) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(pageAccess ? { "X-Lab-Page": pageAccess } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request could not be completed.",
    );
  return data;
}
function showError(e) {
  $("error").textContent = e.message || String(e);
}
function waitForPeer(
  peer,
  event,
  predicate,
  timeout,
  signal,
  allowTimeout = false,
) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(deadline);
      peer.removeEventListener(event, check);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (predicate()) finish();
    };
    const abort = () => finish(new Error("Camera attempt cancelled"));
    const deadline = setTimeout(
      () =>
        finish(
          allowTimeout
            ? undefined
            : new Error("Camera connection timed out. Try another network."),
        ),
      timeout,
    );
    peer.addEventListener(event, check);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });
}
const camera = new CameraSession({
  nextSequence: () => {
    const sequence = Number(sessionStorage.getItem("labSequence") || 0) + 1;
    sessionStorage.setItem("labSequence", String(sequence));
    return sequence;
  },
  release: (connectionId) => api("/disconnect", { connectionId }),
  onChange: (value) => {
    connecting = value;
    $("connect").disabled = ended || connecting;
  },
  onError: showError,
  run: async (attempt) => {
    $("error").textContent = "";
    await attempt.claim(api("/camera-claim", { sequence: attempt.sequence }));
    const post = (path, body = {}) =>
      api(path, { ...body, connectionId: attempt.lease }, attempt.abort.signal);
    await post("/camera-start");
    attempt.check();
    const stream = await attempt.acquire(
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 720, max: 1280 },
          height: { ideal: 1280, max: 1280 },
          frameRate: { ideal: 60, max: 60 },
        },
      }),
      (value) => {
        value.getTracks().forEach((t) => t.stop());
        if ($("local").srcObject === value) $("local").srcObject = null;
      },
    );
    $("local").srcObject = stream;
    const track = stream.getVideoTracks()[0],
      settings = track.getSettings();
    $("capture").textContent =
      `Camera capture: ${settings.width}  /  ${settings.height}  /  ${Math.round(settings.frameRate || 0)} fps. Microphone off.`;
    const peer = await attempt.acquire(
      Promise.resolve(
        new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          bundlePolicy: "max-bundle",
        }),
      ),
      (value) => {
        value.onconnectionstatechange = null;
        value.close();
      },
    );
    const tr = peer.addTransceiver(track, {
      direction: "sendonly",
      streams: [stream],
    });
    const codecs = RTCRtpSender.getCapabilities("video").codecs.filter(
      (c) =>
        c.mimeType.toLowerCase() === "video/h264" &&
        (!c.sdpFmtpLine || c.sdpFmtpLine.includes("packetization-mode=1")),
    );
    if (!codecs.length || !tr.setCodecPreferences)
      throw new Error(
        "This browser cannot send the H.264 video this test needs. Try Safari on iPhone or Chrome on Android.",
      );
    tr.setCodecPreferences(codecs);
    const params = tr.sender.getParameters();
    params.degradationPreference = "maintain-resolution";
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    params.encodings[0].maxBitrate = 4000000;
    params.encodings[0].maxFramerate = 60;
    await tr.sender.setParameters(params);
    attempt.check();
    let offer = await peer.createOffer();
    attempt.check();
    // Real-phone orientation and adaptive dimensions remain qualification gates.
    offer.sdp = offer.sdp
      .split("\r\n")
      .filter((l) => !l.includes("urn:3gpp:video-orientation"))
      .join("\r\n");
    await peer.setLocalDescription(offer);
    attempt.check();
    await waitForPeer(
      peer,
      "icegatheringstatechange",
      () => peer.iceGatheringState === "complete",
      1500,
      attempt.abort.signal,
      true,
    );
    attempt.check();
    const result = await post("/attach", {
      offer: { type: "offer", sdp: peer.localDescription.sdp },
      mid: tr.mid,
    });
    attempt.check();
    await peer.setRemoteDescription(result.sessionDescription);
    attempt.check();
    await waitForPeer(
      peer,
      "connectionstatechange",
      () => peer.connectionState === "connected",
      20000,
      attempt.abort.signal,
    );
    attempt.check();
    let sending = false;
    for (let n = 0; n < 20; n++) {
      const stats = await peer.getStats();
      attempt.check();
      sending = [...stats.values()].some(
        (s) =>
          s.type === "outbound-rtp" &&
          s.kind === "video" &&
          s.packetsSent > 0 &&
          s.framesEncoded > 0,
      );
      if (sending) break;
      await new Promise((r) => setTimeout(r, 500));
      attempt.check();
    }
    if (!sending)
      throw new Error(
        "The browser connected but could not start H.264 video. Try another browser or phone.",
      );
    await post("/receive");
    attempt.check();
    peer.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(peer.connectionState) && !ended) {
        showError(new Error("Camera connection lost. Trying to reconnect / "));
        camera.reconnect(attempt);
      }
    };
    if (navigator.wakeLock)
      await attempt.acquire(
        navigator.wakeLock.request("screen").catch(() => null),
        (value) => value?.release().catch(() => {}),
      );
  },
});
function localStop() {
  return camera.disconnect();
}
function disconnect() {
  return camera.disconnect();
}
function connect() {
  if (!ended) return camera.connect();
}
function stopPreview() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  $("program").pause();
  $("program").removeAttribute("src");
  $("program").load();
  previewGeneration = -1;
}
function preview(generation) {
  if (previewGeneration === generation) return;
  stopPreview();
  previewGeneration = generation;
  const video = $("program"),
    url = "/hls/program.m3u8";
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    video.play().catch(() => {});
  } else if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 6 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  } else
    showError(
      new Error(
        "Preview playback is unavailable in this browser. Try Safari or Chrome.",
      ),
    );
}
async function poll() {
  try {
    const s = await api("/status");
    if (role !== null && role !== s.role)
      throw new Error("This page role changed. Reopen its private link.");
    role = s.role;
    ended = s.ended;
    $("role").textContent =
      role === "control" ? "Test control" : `Camera ${role.slice(-1)}`;
    $("control").hidden = role !== "control";
    $("camera").hidden = role === "control";
    $("previewPanel").hidden = role !== "control";
    $("message").textContent = s.message;
    $("remaining").textContent = ended
      ? "Test finished"
      : `${Math.floor(s.remaining / 60)}:${String(s.remaining % 60).padStart(2, "0")} remaining`;
    $("start").disabled = s.started || ended;
    $("stop").disabled = !s.started || ended;
    $("connect").disabled = ended || connecting;
    if (role !== "control" && !s.started && !ended)
      $("message").textContent =
        "Tap Connect camera to start your 10-minute test. No desktop start is needed.";
    for (const slot of [1, 2]) {
      const c = s.cameras[String(slot)];
      $("cam" + slot).textContent =
        `Camera ${slot} · ${c?.connected ? "receiving video" : "waiting"}`;
    }
    $("metrics").textContent =
      `${s.encodedFrames.toLocaleString()} encoded frames · ${s.encoderFps.toFixed(1)} average encoder fps`;
    if (role === "control") {
      if (s.preview) preview(s.generation);
      else if (previewGeneration !== -1) stopPreview();
    }
    if (ended) {
      await localStop();
      clearInterval(timer);
    }
  } catch (e) {
    showError(e);
    await localStop();
    stopPreview();
    clearInterval(timer);
  }
}
$("start").onclick = () => api("/start", {}).then(poll).catch(showError);
$("stop").onclick = () => api("/stop", {}).then(poll).catch(showError);
$("connect").onclick = () => connect()?.catch(showError);
$("disconnect").onclick = () => disconnect().catch(showError);
$("score").onclick = () =>
  api("/score", { red: Number($("red").value), blue: Number($("blue").value) })
    .then(() => {
      $("error").textContent = "";
    })
    .catch(showError);
window.addEventListener("pagehide", () => {
  const lease = camera.current?.lease;
  void localStop();
  if (lease)
    fetch("/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Lab-Page": pageAccess },
      body: JSON.stringify({ connectionId: lease }),
      keepalive: true,
    }).catch(() => {});
});
(async () => {
  try {
    const token = location.hash.slice(1);
    if (token) {
      const auth = await api("/auth", { token });
      role = auth.role;
      pageAccess = auth.pageAccess;
      sessionStorage.setItem("labPageAccess", pageAccess);
      sessionStorage.setItem("labSequence", "0");
      history.replaceState(null, "", location.pathname);
    }
    await poll();
    if (!ended) timer = setInterval(poll, 2000);
  } catch (e) {
    showError(e);
    $("message").textContent =
      "Open the private link provided for this device.";
  }
})();
