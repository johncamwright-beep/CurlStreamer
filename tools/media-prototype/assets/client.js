/* Isolated prototype: no production game actions and no microphone capture. */
const el = (id) => document.getElementById(id);
let room, track, poller, hls, wakeLock;
let connecting = false,
  cameraEpoch = 0;
async function api(path, body) {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request could not be completed.",
    );
  return data;
}
function message(value) {
  el("message").textContent = value;
}
async function action(fn) {
  try {
    message("");
    await fn();
  } catch (error) {
    message(error.message);
  }
}
async function disconnect() {
  cameraEpoch += 1;
  if (track) {
    track.stop();
    track.detach();
    track = undefined;
  }
  if (room) {
    const previousRoom = room;
    room = undefined;
    await previousRoom.disconnect().catch(() => {});
  }
  if (wakeLock) {
    await wakeLock.release().catch(() => {});
    wakeLock = undefined;
  }
  el("local").hidden = true;
  el("cameraState").textContent = "Camera off.";
}
async function refresh() {
  const status = await api("status");
  const active = ["starting", "running", "stopping"].includes(status.state);
  el("state").textContent =
    {
      idle: "Not started",
      starting: "Connecting",
      running: "Test running",
      stopping: "Stopping",
      stopped: "Test ended",
      failed: "Test stopped with an error",
    }[status.state] || "Status unavailable";
  el("start").disabled = active;
  el("stop").disabled = !active;
  el("profile").disabled = active;
  if (status.profile) el("profile").value = status.profile;
  el("progress").textContent = active
    ? `${status.profile} · ${status.elapsed}s of ${status.limitSeconds}s · ${status.frames || 0} encoded frames`
    : "Press Start to begin a new bounded test.";
  el("cameras").textContent = ["home", "away"]
    .map(
      (role, i) =>
        `Camera ${i + 1}: ${status.cameras?.[role]?.connected ? `${status.cameras[role].receivedFps} fps received` : "waiting"}`,
    )
    .join(" · ");
  if (status.error) message(status.error);
  if (!active) {
    clearInterval(poller);
    poller = undefined;
    await disconnect();
    if (hls) {
      hls.destroy();
      hls = undefined;
    }
    el("program").removeAttribute("src");
    el("program").load();
  }
  return status;
}
function poll() {
  clearInterval(poller);
  poller = setInterval(
    () =>
      refresh().catch(async () => {
        clearInterval(poller);
        message(
          "Connection to the processor was lost. Reopen the test page to check its status.",
        );
        await disconnect();
      }),
    3000,
  );
}
async function login(code) {
  await api("login", { code });
  const status = await refresh();
  el("login").hidden = true;
  el("workspace").hidden = false;
  if (["starting", "running", "stopping"].includes(status.state)) poll();
}
el("loginForm").onsubmit = (event) => {
  event.preventDefault();
  action(() => login(el("code").value));
};
const initialCode = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
if (initialCode) action(() => login(initialCode));
el("start").onclick = () =>
  action(async () => {
    el("start").disabled = true;
    try {
      await api("start", { profile: el("profile").value });
      poll();
      await refresh();
    } finally {
      if (!poller) el("start").disabled = false;
    }
  });
el("stop").onclick = () =>
  action(async () => {
    el("stop").disabled = true;
    await disconnect();
    await api("stop", {});
    await refresh();
  });
el("disconnect").onclick = () => action(disconnect);
async function connect(role) {
  if (connecting) return;
  connecting = true;
  el("home").disabled = el("away").disabled = true;
  await disconnect();
  const epoch = cameraEpoch;
  const candidate = new LivekitClient.Room({
    adaptiveStream: false,
    dynacast: false,
  });
  try {
    const auth = await api("camera/" + role);
    if (epoch !== cameraEpoch) throw new Error("Camera connection cancelled.");
    await candidate.connect(auth.url, auth.token, { autoSubscribe: false });
    if (epoch !== cameraEpoch) throw new Error("Camera connection cancelled.");
    const camera = await LivekitClient.createLocalVideoTrack({
      facingMode: "environment",
      resolution: { width: 720, height: 1280, frameRate: auth.fps },
    });
    if (epoch !== cameraEpoch) {
      camera.stop();
      throw new Error("Camera connection cancelled.");
    }
    room = candidate;
    track = camera;
    await room.localParticipant.publishTrack(track, {
      source: LivekitClient.Track.Source.Camera,
      videoCodec: "h264",
      simulcast: false,
      videoEncoding: { maxBitrate: 4000000, maxFramerate: auth.fps },
    });
    if (epoch !== cameraEpoch) {
      camera.stop();
      throw new Error("Camera connection cancelled.");
    }
    track.attach(el("local"));
    el("local").hidden = false;
    const settings = track.mediaStreamTrack.getSettings();
    el("cameraState").textContent =
      `Camera ${role === "home" ? "1" : "2"} connected · ${settings.width}×${settings.height} · ${settings.frameRate ? Math.round(settings.frameRate) + " fps captured" : "capture frame rate unavailable"} · microphone off`;
    room.on(LivekitClient.RoomEvent.Reconnecting, () => {
      el("cameraState").textContent = "Camera reconnecting…";
    });
    room.on(LivekitClient.RoomEvent.Reconnected, () => {
      el("cameraState").textContent = "Camera connected again · microphone off";
    });
    room.on(LivekitClient.RoomEvent.Disconnected, () => {
      if (room === candidate)
        el("cameraState").textContent = "Camera disconnected.";
      camera.stop();
    });
    if (navigator.wakeLock)
      wakeLock = await navigator.wakeLock
        .request("screen")
        .catch(() => undefined);
    if (epoch !== cameraEpoch) throw new Error("Camera connection cancelled.");
    poll();
  } catch (error) {
    await candidate.disconnect();
    await disconnect();
    throw error;
  } finally {
    connecting = false;
    el("home").disabled = el("away").disabled = false;
  }
}
el("home").onclick = () => action(() => connect("home"));
el("away").onclick = () => action(() => connect("away"));
el("scoreForm").onsubmit = (event) => {
  event.preventDefault();
  action(async () => {
    await api("score", {
      home: Number(el("red").value),
      away: Number(el("blue").value),
    });
    message("Test score sent to the program.");
  });
};
el("watch").onclick = () =>
  action(async () => {
    const status = await refresh();
    if (!status.previewReady)
      throw new Error(
        "The processed preview is not ready yet. Wait a few seconds after starting.",
      );
    const video = el("program");
    if (hls) hls.destroy();
    if (video.canPlayType("application/vnd.apple.mpegurl"))
      video.src = "/media/program.m3u8";
    else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource("/media/program.m3u8");
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, event) => {
        if (event.fatal)
          message("Preview interrupted. Reload it to reconnect.");
      });
    } else
      throw new Error(
        "This browser cannot play the test preview. Try Safari or Chrome.",
      );
    await video.play().catch(() => {
      message("Tap Play in the video to view the program.");
    });
  });
window.addEventListener("pagehide", () => {
  cameraEpoch += 1;
  track?.stop();
  room?.disconnect();
});
