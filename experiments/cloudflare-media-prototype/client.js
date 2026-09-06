"use strict";
const $ = (id) => document.getElementById(id);
let role = sessionStorage.getItem("labRole") || null,
  hls = null,
  previewGeneration = -1,
  ended = false,
  connecting = false,
  timer = null;
let monitoring = true,
  polling = false,
  resuming = false;
let controlGeneration = 0,
  activeStatusRead = null;
let recoveryTicket = sessionStorage.getItem("labRecoveryTicket") || "";
let absoluteExpires = Number(sessionStorage.getItem("labExpiresAt") || 0);
let lastInstance = sessionStorage.getItem("labInstance") || "";
let observedDeadline = Number(
  sessionStorage.getItem("labObservedDeadline") || 0,
);
let monitorUntil = Date.now() + 60000;
let canStart = true;
let previewEpoch = 0,
  previewDispose = () => {},
  previewState = "idle",
  previewMode = "none",
  previewDiagnosticCount = 0;
let observerPlayerPromise = null;
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
  if (!r.ok) {
    const error = new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request could not be completed.",
    );
    error.status = r.status;
    throw error;
  }
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
  previewEpoch++;
  previewDispose();
  previewDispose = () => {};
  if (hls) {
    hls.destroy();
    hls = null;
  }
  $("program").pause();
  $("program").removeAttribute("src");
  $("program").load();
  previewGeneration = -1;
  setPreviewState("idle", "Preview is not playing.");
}
function setPreviewState(state, message, category = "none") {
  previewState = state;
  const label = $("previewState");
  label.textContent = message;
  label.dataset.state = state;
  label.dataset.mode = previewMode;
  label.dataset.failure = category;
  $("previewRetry").hidden = state !== "error";
  $("previewRetry").disabled = state !== "error";
  if (previewDiagnosticCount++ < 24)
    console.info("PRIVATE_LAB_PREVIEW", { state, mode: previewMode, category });
}
function loadObserverPlayer() {
  if (window.Hls) return Promise.resolve();
  if (!observerPlayerPromise) {
    observerPlayerPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else resolve();
      };
      script.src = "/assets/hls.min.js";
      script.onload = () =>
        finish(
          window.Hls ? undefined : new Error("Observer player unavailable"),
        );
      script.onerror = () => finish(new Error("Observer player unavailable"));
      const deadline = setTimeout(
        () => finish(new Error("Observer player load timed out")),
        12000,
      );
      document.head.append(script);
    }).catch((error) => {
      observerPlayerPromise = null;
      throw error;
    });
  }
  return observerPlayerPromise;
}
function preview(generation) {
  if (previewGeneration === generation) return;
  stopPreview();
  previewGeneration = generation;
  const video = $("program"),
    url = "/hls/program.m3u8";
  const epoch = previewEpoch;
  let deadline;
  const listeners = [];
  const current = () => epoch === previewEpoch;
  const fail = (category) => {
    if (!current()) return;
    stopPreview();
    // Latch this generation: ordinary status polls must not retry media forever.
    previewGeneration = generation;
    const message =
      category === "playback_blocked"
        ? "Playback needs your permission. Press Retry preview to play."
        : "Preview could not play. Camera and encoder counters do not verify the picture. Retry preview without restarting the test.";
    setPreviewState("error", message, category);
  };
  const wait = () => {
    if (!current() || deadline) return;
    setPreviewState(
      "loading",
      "Loading preview… The picture is not yet verified.",
    );
    deadline = setTimeout(() => fail("playback_timeout"), 15000);
  };
  const listen = (name, callback) => {
    video.addEventListener(name, callback);
    listeners.push([name, callback]);
  };
  previewDispose = () => {
    clearTimeout(deadline);
    deadline = null;
    for (const [name, callback] of listeners)
      video.removeEventListener(name, callback);
  };
  const play = () => {
    if (!current()) return;
    video
      .play()
      .catch((error) =>
        fail(
          error?.name === "NotAllowedError"
            ? "playback_blocked"
            : "media_error",
        ),
      );
  };
  listen("playing", () => {
    if (!current()) return;
    clearTimeout(deadline);
    deadline = null;
    setPreviewState(
      "playing",
      "Preview is playing. Check both pictures and the score visually.",
    );
  });
  listen("waiting", wait);
  listen("pause", () => {
    if (!current() || video.ended) return;
    clearTimeout(deadline);
    deadline = null;
    setPreviewState("paused", "Preview is paused. Press Play to continue.");
  });
  listen("ended", () => {
    if (!current()) return;
    clearTimeout(deadline);
    deadline = null;
    setPreviewState("ended", "Preview playback ended.");
  });
  listen("error", () =>
    fail(video.error?.code === 2 ? "network_error" : "media_error"),
  );
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    previewMode = "native";
    wait();
    video.src = url;
    play();
  } else if (!window.Hls) {
    previewMode = "mse";
    wait();
    void loadObserverPlayer()
      .then(() => {
        if (!current() || previewGeneration !== generation) return;
        previewGeneration = -1;
        preview(generation);
      })
      .catch(() => {
        if (current() && previewGeneration === generation) fail("unsupported");
      });
  } else if (Hls.isSupported()) {
    previewMode = "mse";
    wait();
    hls = new Hls({ maxBufferLength: 6 });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal)
        fail(
          data.type === Hls.ErrorTypes.NETWORK_ERROR
            ? "network_error"
            : "media_error",
        );
    });
    hls.on(Hls.Events.MANIFEST_PARSED, play);
    hls.loadSource(url);
    hls.attachMedia(video);
  } else {
    previewMode = "unsupported";
    fail("unsupported");
  }
}
$("previewRetry").onclick = () => {
  if (
    role !== "control" ||
    !monitoring ||
    ended ||
    document.hidden ||
    previewState !== "error" ||
    previewGeneration < 0
  )
    return;
  if (
    (absoluteExpires && Date.now() >= absoluteExpires * 1000) ||
    (observedDeadline && Date.now() >= observedDeadline)
  )
    return;
  const generation = previewGeneration;
  previewGeneration = -1;
  preview(generation);
};
function pauseControl(message) {
  controlGeneration++;
  activeStatusRead?.abort();
  activeStatusRead = null;
  polling = false;
  monitoring = false;
  clearInterval(timer);
  timer = null;
  for (const id of ["start", "stop", "score"]) $(id).disabled = true;
  $("resume").hidden = Boolean(
    !recoveryTicket ||
      ended ||
      (absoluteExpires && Date.now() >= absoluteExpires * 1000),
  );
  $("connection").textContent = message;
  stopPreview();
}
async function controlRead(path, body, abort = new AbortController()) {
  const timeout = setTimeout(() => abort.abort(), 15000);
  try {
    return await api(path, body, abort.signal);
  } finally {
    clearTimeout(timeout);
  }
}
function bindAuth(auth, freshLink = false) {
  role = auth.role;
  pageAccess = auth.pageAccess;
  canStart = auth.canStart !== false;
  absoluteExpires = auth.expiresAt || 0;
  sessionStorage.setItem("labPageAccess", pageAccess);
  sessionStorage.setItem("labRole", role);
  sessionStorage.setItem("labExpiresAt", String(absoluteExpires));
  if (freshLink) {
    recoveryTicket = auth.recoveryTicket || "";
    sessionStorage.setItem("labRecoveryTicket", recoveryTicket);
    sessionStorage.setItem("labSequence", "0");
    lastInstance = "";
    observedDeadline = 0;
    sessionStorage.setItem("labInstance", "");
    sessionStorage.setItem("labObservedDeadline", "0");
  }
}
function startPolling() {
  clearInterval(timer);
  if (monitoring && !ended) timer = setInterval(() => void poll(), 2000);
}
async function resumeControl() {
  if (resuming || !recoveryTicket || ended) return;
  if (absoluteExpires && Date.now() >= absoluteExpires * 1000) {
    pauseControl("Private link expired. Request a fresh test link.");
    return;
  }
  resuming = true;
  $("resume").disabled = true;
  pauseControl("Reconnecting control… No test actions will be repeated.");
  const generation = controlGeneration;
  try {
    const auth = await controlRead("/resume-control", {
      ticket: recoveryTicket,
    });
    if (generation !== controlGeneration || document.hidden) return;
    if (auth.role !== "control" || auth.canStart !== false)
      throw new Error("Reopen the private control link.");
    bindAuth(auth);
    monitoring = true;
    monitorUntil = Date.now() + 60000;
    if (await poll()) startPolling();
  } catch (e) {
    showError(e);
    if (e.status === 410) {
      absoluteExpires = 1;
      ended = true;
      $("remaining").textContent = "Private link expired";
    }
    pauseControl(
      e.status === 410
        ? "Private link expired. Request a fresh test link."
        : "Control disconnected. Resume to check again, or reopen a fresh private link.",
    );
  } finally {
    resuming = false;
    $("resume").disabled = false;
  }
}
async function poll() {
  if (!monitoring || polling) return false;
  if (absoluteExpires && Date.now() >= absoluteExpires * 1000) {
    ended = true;
    $("remaining").textContent = "Private link expired";
    pauseControl("Private link expired. Request a fresh test link.");
    await localStop();
    return false;
  }
  if (
    role === "control" &&
    (document.hidden ||
      Date.now() >= monitorUntil ||
      (absoluteExpires && Date.now() >= absoluteExpires * 1000))
  ) {
    pauseControl(
      "Control monitoring paused. Resume when you are ready to watch.",
    );
    return false;
  }
  polling = true;
  const generation = controlGeneration;
  const abort = new AbortController();
  activeStatusRead = abort;
  try {
    const s = await controlRead("/status", undefined, abort);
    if (!monitoring || generation !== controlGeneration) return false;
    if (role !== null && role !== s.role)
      throw new Error("This page role changed. Reopen its private link.");
    role = s.role;
    ended = s.ended;
    canStart = s.canStart !== false;
    absoluteExpires = s.expiresAt || absoluteExpires;
    sessionStorage.setItem("labRole", role);
    sessionStorage.setItem("labExpiresAt", String(absoluteExpires));
    const replaced = Boolean(
      lastInstance && s.instance && lastInstance !== s.instance,
    );
    if (replaced) observedDeadline = 0;
    if (s.instance) lastInstance = s.instance;
    if (s.started && !ended) {
      const deadline =
        Date.now() + Math.min(600, Math.max(0, s.remaining)) * 1000;
      observedDeadline = observedDeadline
        ? Math.min(observedDeadline, deadline)
        : deadline;
      monitorUntil = observedDeadline + 3000;
    }
    sessionStorage.setItem("labInstance", lastInstance);
    sessionStorage.setItem("labObservedDeadline", String(observedDeadline));
    $("connection").textContent = replaced
      ? "Server changed. Showing its current test; the earlier session was not restored."
      : !canStart && role === "control"
        ? "Control resumed. A fresh private link is required to start a new test."
        : "";
    $("resume").hidden = true;
    $("error").textContent = "";
    $("role").textContent =
      role === "control" ? "Test control" : `Camera ${role.slice(-1)}`;
    $("control").hidden = role !== "control";
    $("camera").hidden = role === "control";
    $("previewPanel").hidden = role !== "control";
    $("message").textContent = s.message;
    $("remaining").textContent = ended
      ? "Test finished"
      : `${Math.floor(s.remaining / 60)}:${String(s.remaining % 60).padStart(2, "0")} remaining`;
    $("start").disabled = !canStart || s.started || ended;
    $("stop").disabled = !s.started || ended;
    $("score").disabled = !s.started || ended;
    $("connect").disabled = ended || connecting;
    if (role !== "control" && !s.started && !ended)
      $("message").textContent =
        "Tap Connect camera to start your 10-minute test. No desktop start is needed.";
    for (const slot of [1, 2]) {
      const c = s.cameras[String(slot)];
      $("cam" + slot).textContent =
        `Camera ${slot} · ${c?.connected ? "receiving packets" : "waiting"}`;
    }
    $("metrics").textContent =
      `${s.encodedFrames.toLocaleString()} encoded output frames · ${s.encoderFps.toFixed(1)} average encoder fps · camera motion not verified by these counters`;
    if (role === "control") {
      if (s.preview) preview(s.generation);
      else if (previewGeneration !== -1) stopPreview();
    }
    if (ended) {
      pauseControl("Test ended. Automatic monitoring stopped.");
      await localStop();
    }
    return monitoring && !ended;
  } catch (e) {
    if (generation !== controlGeneration) return false;
    showError(e);
    if (e.status === 410) {
      absoluteExpires = 1;
      ended = true;
      $("remaining").textContent = "Private link expired";
    }
    // Pause immediately, before any best-effort camera cleanup can block.
    pauseControl(
      e.status === 410
        ? "Private link expired. Request a fresh test link."
        : role === "control"
          ? "Control disconnected. Resume to check the current test; actions are paused."
          : "Camera disconnected. Reopen this camera’s private link, then tap Connect camera.",
    );
    await localStop();
    return false;
  } finally {
    if (generation === controlGeneration) {
      polling = false;
      activeStatusRead = null;
    }
  }
}
$("resume").onclick = () => void resumeControl();
document.addEventListener("visibilitychange", () => {
  if (role === "control" && document.hidden)
    pauseControl(
      "Control monitoring paused while this page is hidden. Resume when ready.",
    );
});
$("start").onclick = () =>
  monitoring && api("/start", {}).then(poll).catch(showError);
$("stop").onclick = () =>
  monitoring && api("/stop", {}).then(poll).catch(showError);
$("connect").onclick = () => connect()?.catch(showError);
$("disconnect").onclick = () => disconnect().catch(showError);
$("score").onclick = () =>
  monitoring &&
  api("/score", { red: Number($("red").value), blue: Number($("blue").value) })
    .then(() => {
      $("error").textContent = "";
    })
    .catch(showError);
window.addEventListener("pagehide", () => {
  pauseControl("Control monitoring paused. Resume when ready.");
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
      bindAuth(await controlRead("/auth", { token }), true);
      history.replaceState(null, "", location.pathname);
    }
    if (await poll()) startPolling();
  } catch (e) {
    showError(e);
    if (e.status === 410) {
      absoluteExpires = 1;
      ended = true;
      $("remaining").textContent = "Private link expired";
    }
    pauseControl(
      e.status === 410
        ? "Private link expired. Request a fresh test link."
        : "Open the private link provided for this device.",
    );
    $("message").textContent =
      "Open the private link provided for this device.";
  }
})();
