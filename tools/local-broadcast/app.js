const $ = (id) => document.getElementById(id);
const fragment = location.hash.slice(1);
if (fragment) sessionStorage.setItem("lab-access", fragment);
history.replaceState(null, "", location.pathname);
const [role, token] = (sessionStorage.getItem("lab-access") || "").split(":");
const host = role === "host";
const peers = new Map();
let stopSynthetic = () => {};
let lastPaint = 0;
let signalQueue = Promise.resolve();
let cameraStream,
  microphone,
  recorder,
  polling = true,
  pendingBytes = 0,
  sequence = 0;
let upload = Promise.resolve(),
  paintCount = 0,
  outputStarted = 0,
  stopping = false;
const videos = new Map(),
  lastFrame = new Map(),
  stats = new Map();
const canvas = $("program"),
  ctx = canvas.getContext("2d");
async function api(path, data, raw = false) {
  const headers = { authorization: `Bearer ${token}` };
  if (raw) headers["x-chunk-sequence"] = String(sequence++);
  else if (data !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers,
    body: raw ? data : data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Connection failed");
  return result;
}
const signal = (to, data) => {
  const sent = signalQueue.then(() => api("/signal", { to, data }));
  signalQueue = sent.catch(() => {});
  return sent;
};
function message(text) {
  $("message").textContent = text;
}
function closePeer(name) {
  peers.get(name)?.pc.close();
  peers.delete(name);
  videos.delete(name);
  lastFrame.delete(name);
}
function peer(name) {
  closePeer(name);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const value = { pc, ice: [] };
  peers.set(name, value);
  pc.onicecandidate = (event) => {
    if (event.candidate)
      signal(name, { type: "ice", candidate: event.candidate.toJSON() }).catch(
        () => message("Camera signaling interrupted"),
      );
  };
  pc.onconnectionstatechange = () => {
    if (!host)
      $("camera-status").textContent = `Connection: ${pc.connectionState}`;
    if (pc.connectionState === "failed")
      message(
        "Camera connection failed. Disconnect and reconnect to try again.",
      );
  };
  if (host)
    pc.ontrack = ({ track }) => {
      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([track]);
      videos.set(name, video);
      video.play().catch(() => message("Camera preview could not play"));
      function frame() {
        lastFrame.set(name, performance.now());
        if (videos.get(name) === video) video.requestVideoFrameCallback(frame);
      }
      video.requestVideoFrameCallback(frame);
    };
  return value;
}
async function receive({ from, data }) {
  if (data.type === "stop") {
    await disconnectCamera(false);
    message("The scoring computer ended this test.");
    return;
  }
  if (data.type === "bye") {
    closePeer(from);
    return;
  }
  if (data.type === "hello" && host) {
    const { pc } = peer(from);
    pc.addTransceiver("video", { direction: "recvonly" });
    await pc.setLocalDescription(await pc.createOffer());
    await signal(from, { type: "offer", description: pc.localDescription });
    return;
  }
  if (data.type === "offer" && !host && cameraStream) {
    const value = peer("host");
    cameraStream
      .getTracks()
      .forEach((track) => value.pc.addTrack(track, cameraStream));
    await value.pc.setRemoteDescription(data.description);
    await value.pc.setLocalDescription(await value.pc.createAnswer());
    await signal("host", {
      type: "answer",
      description: value.pc.localDescription,
    });
    return;
  }
  const value = peers.get(from);
  if (!value) return;
  if (data.type === "answer") {
    await value.pc.setRemoteDescription(data.description);
    for (const ice of value.ice.splice(0)) await value.pc.addIceCandidate(ice);
  }
  if (data.type === "ice") {
    if (value.pc.remoteDescription)
      await value.pc.addIceCandidate(data.candidate);
    else value.ice.push(data.candidate);
  }
}
async function poll() {
  while (polling) {
    try {
      const value = await api("/poll");
      for (const item of value.messages) await receive(item);
      if (!host && cameraStream && !value.hostAvailable) {
        await disconnectCamera(false);
        message("Scoring computer is offline. Camera stopped.");
      }
      if (host) {
        $("youtube").hidden = !value.youtubeConfigured;
        $("output-status").textContent =
          `${value.state} · ${(value.bytes / 1e6).toFixed(1)} MB sent to local helper · ${value.encoder}${value.error ? ` · ${value.error}` : ""}`;
        if (
          recorder?.state === "recording" &&
          ["failed", "stopped"].includes(value.state) &&
          !stopping
        )
          await endTest();
      }
    } catch {
      message("Helper connection lost. Check the scoring computer.");
      if (cameraStream) await disconnectCamera(false);
      if (recorder?.state === "recording") await endTest().catch(() => {});
    }
    await new Promise((done) => setTimeout(done, 700));
  }
}
async function connectCamera(synthetic = false) {
  await disconnectCamera(false);
  if (synthetic) {
    const source = document.createElement("canvas");
    source.width = 720;
    source.height = 1280;
    const context = source.getContext("2d");
    let active = true;
    stopSynthetic = () => {
      active = false;
    };
    function draw() {
      if (!active) return;
      context.fillStyle = role === "camera1" ? "#234960" : "#365c48";
      context.fillRect(0, 0, 720, 1280);
      context.fillStyle = "white";
      context.font = "40px sans-serif";
      context.fillText(`SIMULATED ${role}`, 40, 90);
      context.beginPath();
      context.arc(
        360 + 220 * Math.sin(performance.now() / 450),
        640,
        80,
        0,
        Math.PI * 2,
      );
      context.fill();
      requestAnimationFrame(draw);
    }
    draw();
    cameraStream = source.captureStream(60);
    cameraStream.getVideoTracks()[0].addEventListener("ended", () => {
      active = false;
    });
  } else
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 720 },
        height: { ideal: 1280 },
        frameRate: { ideal: 60 },
        facingMode: { ideal: "environment" },
      },
      audio: false,
    });
  $("camera-preview").srcObject = cameraStream;
  $("connect").disabled = true;
  await signal("host", { type: "hello" });
  const settings = cameraStream.getVideoTracks()[0].getSettings();
  $("camera-status").textContent =
    `${synthetic ? "Simulated camera" : "Camera"} · ${settings.width}×${settings.height} · ${settings.frameRate || "unknown"} fps requested/captured`;
}
async function disconnectCamera(notify = true) {
  stopSynthetic();
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  $("camera-preview").srcObject = null;
  closePeer("host");
  $("connect").disabled = false;
  $("camera-status").textContent = "Camera off";
  if (notify) await signal("host", { type: "bye" }).catch(() => {});
}
function contain(video, x, y, w, h) {
  const ratio = Math.min(w / video.videoWidth, h / video.videoHeight);
  if (!Number.isFinite(ratio)) return;
  ctx.drawImage(
    video,
    x + (w - video.videoWidth * ratio) / 2,
    y + (h - video.videoHeight * ratio) / 2,
    video.videoWidth * ratio,
    video.videoHeight * ratio,
  );
}
function paint() {
  const now = performance.now();
  if (!peers.size && !recorder && now - lastPaint < 1000) {
    requestAnimationFrame(paint);
    return;
  }
  lastPaint = now;
  ctx.fillStyle = "#071321";
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = "#edf5fc";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(
    `${$("home").value}  ${$("home-score").value}     —     ${$("away-score").value}  ${$("away").value}`,
    36,
    48,
    1208,
  );
  for (let i = 0; i < 2; i++) {
    const name = `camera${i + 1}`,
      x = 24 + i * 628;
    ctx.fillStyle = "#142538";
    ctx.fillRect(x, 80, 604, 560);
    const video = videos.get(name);
    if (video && performance.now() - (lastFrame.get(name) || 0) < 3000)
      contain(video, x, 80, 604, 560);
    else {
      ctx.fillStyle = "#aec6d8";
      ctx.font = "22px sans-serif";
      ctx.fillText(`Camera ${i + 1} · waiting`, x + 30, 350);
    }
  }
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#aec6d8";
  ctx.fillText(
    `LOCAL BROADCAST TEST · ${microphone ? "COMPUTER MICROPHONE" : "SILENT AUDIO"}`,
    36,
    686,
  );
  paintCount++;
  requestAnimationFrame(paint);
}
async function startOutput(youtube = false) {
  if (recorder && recorder.state !== "inactive") return;
  const mimeType = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType)
    throw Error(
      "This browser cannot record the local test. Use Chrome or Edge on the scoring computer.",
    );
  await api("/start", { audio: Boolean(microphone), youtube });
  const stream = canvas.captureStream(60);
  microphone?.getAudioTracks().forEach((track) => stream.addTrack(track));
  recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 128_000,
  });
  upload = Promise.resolve();
  sequence = 0;
  pendingBytes = 0;
  outputStarted = performance.now();
  recorder.ondataavailable = ({ data }) => {
    if (!data.size) return;
    pendingBytes += data.size;
    if (pendingBytes > 8 * 1024 * 1024) {
      message("The local helper cannot keep up. Stopping the test.");
      void endTest();
      return;
    }
    upload = upload
      .then(() => api("/chunk", data, true))
      .then(() => {
        pendingBytes -= data.size;
      })
      .catch(() => {
        message("Recording delivery failed. Stop and start a new test.");
        if (!stopping) void endTest();
      });
  };
  recorder.onerror = () => {
    message("Browser recording failed");
    void endTest();
  };
  recorder.start(500);
  $("record").disabled =
    $("youtube").disabled =
    $("microphone").disabled =
    $("mic-enable").disabled =
      true;
  message(
    youtube
      ? "Sending to YouTube. This lab cannot confirm that YouTube is live."
      : "Recording on this computer. Nothing is being sent to YouTube.",
  );
}
async function endTest() {
  if (stopping) return;
  stopping = true;
  try {
    if (recorder?.state !== "inactive" && recorder)
      await new Promise((done) => {
        recorder.addEventListener("stop", done, { once: true });
        recorder.stop();
      });
    await upload;
    await api("/stop", {});
  } finally {
    recorder?.stream.getTracks().forEach((track) => track.stop());
    recorder = null;
    microphone?.getTracks().forEach((track) => track.stop());
    microphone = null;
    $("audio-status").textContent = "Audio is OFF.";
    for (const name of [...peers.keys()]) closePeer(name);
    $("record").disabled =
      $("youtube").disabled =
      $("microphone").disabled =
      $("mic-enable").disabled =
        false;
    stopping = false;
  }
}
async function metrics() {
  for (const [name, { pc }] of peers) {
    const report = await pc.getStats();
    let inbound, pair, local, remote;
    report.forEach((s) => {
      if (s.type === "inbound-rtp" && s.kind === "video") inbound = s;
      if (s.type === "transport" && s.selectedCandidatePairId)
        pair = report.get(s.selectedCandidatePairId);
    });
    if (pair) {
      local = report.get(pair.localCandidateId);
      remote = report.get(pair.remoteCandidateId);
    }
    const route = !pair
      ? "connecting"
      : local?.candidateType === "relay" || remote?.candidateType === "relay"
        ? "relay"
        : "direct";
    const item = {
      state: pc.connectionState,
      route,
      fps: inbound?.framesPerSecond ?? 0,
      bytes: inbound?.bytesReceived ?? 0,
      frames: inbound?.framesDecoded ?? 0,
    };
    stats.set(name, item);
    if (host)
      $(`${name}-status`).textContent =
        `${name === "camera1" ? "Camera 1" : "Camera 2"}: ${item.state} · ${route} · ${item.fps} fps received`;
  }
  if (host) {
    $("performance").textContent =
      `Canvas: ${paintCount} frames in the last second · queued ${(pendingBytes / 1e6).toFixed(1)} MB`;
    paintCount = 0;
  }
}
function action(id, callback) {
  $(id).onclick = () =>
    Promise.resolve()
      .then(callback)
      .catch((e) => message(e.message));
}
if (!["host", "camera1", "camera2"].includes(role) || !token)
  message("Open the private access link created by the local helper.");
else {
  $(host ? "host" : "camera").hidden = false;
  $("intro").textContent = host
    ? "This computer receives cameras and builds the programme. Keep this tab visible and the computer awake."
    : "Your phone sends video directly to the scoring computer when the network allows it.";
  $("camera-title").textContent = role === "camera2" ? "Camera 2" : "Camera 1";
  if (host) paint();
  void poll();
  setInterval(() => metrics().catch(() => {}), 1000);
}
action("connect", () => connectCamera());
action("disconnect", () => disconnectCamera());
action("record", () => startOutput());
action("youtube", () => startOutput(true));
action("stop", endTest);
action("microphone", async () => {
  const permission = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });
  permission.getTracks().forEach((track) => track.stop());
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "audioinput",
  );
  $("mic-device").replaceChildren(
    ...devices.map(
      (device) => new Option(device.label || "Microphone", device.deviceId),
    ),
  );
  $("mic-label").hidden = $("mic-enable").hidden = false;
});
action("mic-enable", async () => {
  microphone?.getTracks().forEach((track) => track.stop());
  microphone = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: $("mic-device").value } },
    video: false,
  });
  $("audio-status").textContent =
    `Audio enabled: ${microphone.getAudioTracks()[0].label}`;
});
window.addEventListener("pagehide", () => {
  polling = false;
  cameraStream?.getTracks().forEach((track) => track.stop());
  microphone?.getTracks().forEach((track) => track.stop());
});
// Test-only hooks in this isolated lab; no production bundle imports this file.
window.lab = {
  connectSynthetic: () => connectCamera(true),
  startOutput,
  endTest,
  disconnectCamera,
  snapshot: () => ({
    peers: Object.fromEntries(stats),
    pendingBytes,
    recording: recorder?.state ?? "inactive",
    elapsed: outputStarted ? (performance.now() - outputStarted) / 1000 : 0,
  }),
};
