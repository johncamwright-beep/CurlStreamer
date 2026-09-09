"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";
import {
  hardwareZoomRange,
  clampZoom,
  type ZoomRange,
} from "@/lib/providers/livekit-client";
import "./phone-camera.css";
import {
  cameraPublishAccessToken,
  organizerAccessToken,
  preserveAndStoreParticipantAccess,
} from "@/lib/access-session";
import {
  acquireRawPortraitCamera,
  deviceIsPortrait,
  type PortraitCaptureReport,
} from "@/lib/providers/camera-capture";
import { OptionalScreenWakeLock } from "@/lib/providers/screen-wake-lock";
import {
  connectStudio,
  type StudioRequest,
} from "@/lib/providers/m2-studio-browser";
import { studioTicketSchema, type StudioSide } from "@/lib/m2-studio-protocol";
import type { DirectMetrics } from "@/lib/providers/direct-peer";
import {
  EnduranceRecorder,
  enduranceStorageKey,
} from "@/lib/providers/m2-endurance-recorder";

export function M2CameraSlot({
  id,
  side,
  cameraRole,
  onReady,
  testRun = 0,
}: {
  id: string;
  side: StudioSide;
  cameraRole: "camera-home" | "camera-away";
  onReady?: (role: "camera-home" | "camera-away", ready: boolean) => void;
  testRun?: number;
}) {
  const [previewReady, setPreviewReady] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange>();
  const [zoom, setZoom] = useState(1);
  const zoomFlight = useRef(false);
  async function updateZoom(value: number) {
    const current = track.current;
    if (!current || !zoomRange || zoomFlight.current) return;
    zoomFlight.current = true;
    try {
      const next = clampZoom(value, zoomRange);
      await current.applyConstraints({
        advanced: [{ zoom: next } as MediaTrackConstraintSet],
      });
      if (current === track.current)
        setZoom(current.getSettings().zoom ?? next);
    } catch {
      setWarning("This phone could not adjust zoom.");
    } finally {
      zoomFlight.current = false;
    }
  }
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | undefined>(undefined);
  const connection = useRef<{ stop: () => void } | undefined>(undefined);
  const wake = useRef<OptionalScreenWakeLock | undefined>(undefined);
  const epoch = useRef(0);
  const setupAbort = useRef<AbortController | undefined>(undefined);
  const active = useRef(false);
  const recorder = useRef<EnduranceRecorder | undefined>(undefined);
  const latestTimed = useRef<string | undefined>(undefined);
  const metricsAt = useRef<number | undefined>(undefined);
  const [timedTest, setTimedTest] = useState("");
  const failure = useRef("");
  const stage = useRef("operation");
  const sessionRef = useRef<string | undefined>(undefined);
  const [session, setSession] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    side === "receiver"
      ? "Register this PC, then pair camera."
      : "Start your camera when Studio is recording on the PC.",
  );
  const [qr, setQr] = useState("");
  const [warning, setWarning] = useState("");
  const [metrics, setMetrics] = useState<DirectMetrics>();
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const captureEvidence = useRef<{
    report?: PortraitCaptureReport;
    stoppedAt?: number;
    stateAfterStop?: MediaStreamTrackState;
  }>({});
  const [claimed, setClaimed] = useState(false);
  const invitation = useRef<string | undefined>(undefined);
  const evidence = useRef<{
    startedAt: number;
    samples: number;
    verifiedSamples: number;
    maxRelayBytes: number;
    last?: DirectMetrics;
  }>({ startedAt: 0, samples: 0, verifiedSamples: 0, maxRelayBytes: 0 });

  const request = async (
    body: Omit<Parameters<StudioRequest>[0], "cameraRole">,
  ) => {
    const requestEpoch = epoch.current;
    const token =
      side === "camera"
        ? cameraPublishAccessToken(localStorage, id, cameraRole)
        : organizerAccessToken(localStorage, id);
    const result = await fetch("/api/games/" + id + "/studio-m2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ ...body, cameraRole }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const value = await result.json().catch(() => null);
    if (!result.ok) {
      if (requestEpoch === epoch.current)
        failure.current =
          side === "camera" && result.status === 409
            ? "The PC connection or camera access is no longer ready. Start recording for this game in Studio, then try again. If this camera was released, scan a fresh invitation."
            : side === "camera" &&
                (result.status === 401 || result.status === 403)
              ? "This camera no longer has access. Ask the organizer for a new camera QR code."
              : "Could not connect to Studio. Check your connection and try again.";
      throw Error("Studio request failed");
    }
    return value;
  };
  function cleanup(reason = "Connection cleanup") {
    recorder.current?.finish("interrupted", reason);
    epoch.current += 1;
    setupAbort.current?.abort();
    setupAbort.current = undefined;
    active.current = false;
    setPreviewReady(false);
    setZoomRange(undefined);
    onReady?.(cameraRole, false);
    connection.current?.stop();
    connection.current = undefined;
    if (track.current) {
      track.current.stop();
      captureEvidence.current.stoppedAt = Date.now();
      captureEvidence.current.stateAfterStop = track.current.readyState;
    }
    track.current = undefined;
    void wake.current?.release();
    wake.current = undefined;
    if (video.current) video.current.srcObject = null;
  }
  useEffect(() => {
    const readInvitation = () => {
      if (side !== "camera") return;
      const incoming = new URLSearchParams(location.hash.slice(1)).get("token");
      if (incoming) {
        cleanup("Operator opened a new camera invitation");
        invitation.current = incoming;
        history.replaceState(null, "", location.pathname);
        setStatus("New invitation received. Tap Connect phone to continue.");
      }
      setClaimed(
        !invitation.current &&
          Boolean(cameraPublishAccessToken(localStorage, id, cameraRole)),
      );
    };
    readInvitation();
    window.addEventListener("hashchange", readInvitation);
    const hide = () => cleanup("Receiver page hidden by navigation or closure");
    window.addEventListener("pagehide", hide);
    return () => {
      cleanup("Receiver component unmounted");
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("hashchange", readInvitation);
    };
    // This component is mounted for one game and one side.
  }, [id, side]);
  useEffect(() => {
    if (side !== "receiver" || !session) return;
    let inFlight = false,
      cancelled = false;
    const timer = setInterval(() => {
      // Keep the PC alive during subscription/negotiation as well as pairing.
      // The connection's credential-renewal timer starts only after subscription.
      if (inFlight) return;
      inFlight = true;
      void request({ action: "check", side, sessionId: session })
        .catch(() => {
          if (!cancelled && sessionRef.current === session) {
            cleanup(
              failure.current || "PC session check network failure or timeout",
            );
            setSession(undefined);
            sessionRef.current = undefined;
            setStatus(
              failure.current ||
                "PC session check could not reach the server. Register this PC again.",
            );
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, side, id]);
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setWarning("");
    failure.current = "";
    stage.current = "operation";
    try {
      await operation();
    } catch {
      cleanup(failure.current || `Could not complete ${stage.current}.`);
      setStatus(failure.current || `Could not complete ${stage.current}.`);
    } finally {
      setBusy(false);
    }
  }
  async function register() {
    stage.current = "PC registration";
    cleanup("Operator registered a replacement PC session");
    setQr("");
    setMetrics(undefined);
    const value = studioTicketSchema.parse(
      await request({ action: "register", side }),
    );
    sessionRef.current = value.sessionId;
    setSession(value.sessionId);
    setStatus("PC registered. Create a camera invitation.");
  }
  async function invite() {
    stage.current = "camera invitation";
    const token = organizerAccessToken(localStorage, id);
    const response = await fetch("/api/games/" + id + "/invitations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ role: cameraRole }),
    });
    const value = await response.json();
    if (!response.ok || !value.token) throw Error();
    const url = new URL(
      "/studio-m2/" + id + "/camera/" + cameraRole,
      location.origin,
    );
    url.hash = new URLSearchParams({ token: value.token }).toString();
    setQr(await QRCode.toDataURL(url.toString(), { width: 300, margin: 2 }));
    setStatus(
      "Scan the invitation on the phone. After it starts the camera, connect this receiver.",
    );
  }
  async function claim() {
    stage.current = "camera claim";
    if (!invitation.current) throw Error();
    const claimant =
      localStorage.getItem("curlcast-device") || crypto.randomUUID();
    localStorage.setItem("curlcast-device", claimant);
    const response = await fetch("/api/games/" + id + "/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: invitation.current, claimant }),
    });
    const value = await response.json();
    if (!response.ok || value.role !== cameraRole || !value.sessionToken)
      throw Error();
    preserveAndStoreParticipantAccess(localStorage, id, value.sessionToken);
    invitation.current = undefined;
    setClaimed(true);
    setStatus("camera claimed. Keep the phone upright and start the camera.");
  }
  async function connect() {
    stage.current = "camera or receiver setup";
    cleanup("Operator restarted the connection");
    setMetrics(undefined);
    setFrameSize({ width: 0, height: 0 });
    captureEvidence.current = {};
    const attempt = epoch.current;
    if (side === "camera") {
      stage.current = "camera capture";
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus(
          "Open this camera page over trusted HTTPS, or localhost on the PC.",
        );
        return;
      }
      const acquired = await acquireRawPortraitCamera(
        navigator.mediaDevices,
        video.current!,
        deviceIsPortrait(screen.orientation, innerWidth, innerHeight),
        (value) => {
          if (attempt !== epoch.current) {
            value.stop();
            throw new DOMException("Capture cancelled", "AbortError");
          }
          track.current = value;
        },
        "native-hd",
      );
      if (attempt !== epoch.current) {
        acquired.track.stop();
        return;
      }
      setWarning(acquired.report.warning ?? "");
      setPreviewReady(true);
      const range =
        typeof acquired.track.getCapabilities === "function"
          ? hardwareZoomRange(acquired.track)
          : undefined;
      setZoomRange(range);
      setZoom(acquired.track.getSettings().zoom ?? range?.min ?? 1);
      captureEvidence.current = { report: acquired.report };
      wake.current = new OptionalScreenWakeLock(
        navigator,
        document,
        setWarning,
      );
      wake.current.start();
    }
    stage.current = "session ticket validation";
    const ticket = studioTicketSchema.parse(
      await request({
        action: side === "camera" ? "begin" : "ticket",
        side,
        ...(side === "receiver" ? { sessionId: sessionRef.current } : {}),
      }),
    );
    if (attempt !== epoch.current) {
      return;
    }
    active.current = true;
    evidence.current = {
      startedAt: Date.now(),
      samples: 0,
      verifiedSamples: 0,
      maxRelayBytes: 0,
    };
    stage.current = "private signaling subscription";
    const controller = new AbortController();
    setupAbort.current = controller;
    const handle = await connectStudio({
      signal: controller.signal,
      side,
      ticket,
      track: track.current,
      request,
      onVideo: (stream) => {
        if (attempt !== epoch.current) return;
        if (video.current) {
          video.current.srcObject = stream;
          void video.current
            .play()
            .catch(() =>
              setWarning("Tap the video to play the complete frame."),
            );
        }
      },
      onMetrics: (value) => {
        if (attempt !== epoch.current) return;
        onReady?.(cameraRole, value.direct);
        if (video.current)
          setFrameSize({
            width: video.current.videoWidth,
            height: video.current.videoHeight,
          });
        metricsAt.current = Date.now();
        setMetrics(value);
        const report = evidence.current;
        report.samples += 1;
        report.verifiedSamples += value.direct ? 1 : 0;
        report.maxRelayBytes = Math.max(report.maxRelayBytes, value.relayBytes);
        report.last = value;
        setStatus(
          value.direct
            ? "Connected to Studio. Keep this page open."
            : "Connecting to Studio…",
        );
      },
      onStop: (reason) => {
        if (attempt !== epoch.current) return;
        failure.current ||= reason;
        cleanup(failure.current);
        setStatus(failure.current);
      },
    }).catch((error: unknown) => {
      if (attempt !== epoch.current) return undefined;
      throw error;
    });
    if (!handle) return;
    if (attempt !== epoch.current) {
      handle.stop();
      return;
    }
    connection.current = handle;
    setStatus("Connecting to Studio…");
  }
  function exportEvidence() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            milestone: "M2",
            source: "browser aggregate statistics",
            physicalLanProof: "Requires operator confirmation",
            side,
            cameraRole,
            displayedFrame: frameSize,
            ...(side === "camera" ? { capture: captureEvidence.current } : {}),
            endedAt: Date.now(),
            ...evidence.current,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `m2-direct-metrics-${cameraRole}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function stopStudio() {
    const current = sessionRef.current;
    cleanup();
    setSession(undefined);
    sessionRef.current = undefined;
    if (current)
      void request({
        action: "stop",
        side: "receiver",
        sessionId: current,
      }).catch(() =>
        setWarning(
          "Receiver stopped. Server authority will expire within 30 seconds.",
        ),
      );
  }
  function exportTimedTest() {
    const saved =
      latestTimed.current ||
      localStorage.getItem(enduranceStorageKey(id + ":" + cameraRole));
    if (!saved) {
      setWarning("No saved timed-test data on this browser yet.");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([saved], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `m2-endurance-${cameraRole}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function startTimedTest() {
    if (
      recorder.current ||
      !connection.current ||
      !evidence.current.last?.direct
    )
      return;
    const test = new EnduranceRecorder({
      save: (data) =>
        localStorage.setItem(enduranceStorageKey(id + ":" + cameraRole), data),
      metrics: () => evidence.current.last,
      context: () => ({
        metricsAt: metricsAt.current,
        visibility: document.visibilityState,
        online: navigator.onLine,
        frameWidth: video.current?.videoWidth,
        frameHeight: video.current?.videoHeight,
      }),
      finished: (outcome) => {
        latestTimed.current = JSON.stringify(test.report);
        recorder.current = undefined;
        stopStudio();
        setTimedTest(
          `Timed test ${outcome}: ${test.report.reason}. ${test.report.persistence === "ok" ? "Results saved in this browser." : "Storage failed; keep this page open and download results now."}`,
        );
        setStatus(
          `Timed test ${outcome}. Camera and receiver session stopped.`,
        );
        void wake.current?.release();
        exportTimedTest();
      },
    });
    test.report.cameraRole = cameraRole;
    try {
      test.start();
    } catch {
      setWarning(
        "Cannot save test data in this browser. Test was not started.",
      );
      return;
    }
    recorder.current = test;
    latestTimed.current = undefined;
    wake.current = new OptionalScreenWakeLock(navigator, document, setWarning);
    wake.current.start();
    setTimedTest(
      `Recording checkpoints every 15 seconds. Automatic stop at ${new Date(test.report.deadline).toLocaleTimeString()}. Keep this page visible.`,
    );
  }
  useEffect(() => {
    if (testRun > 0) startTimedTest();
    // The parent increments this only when both independent slots are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRun]);
  const phoneView = side === "camera";
  if (phoneView)
    return (
      <main
        className="phone-camera"
        aria-label={cameraRole === "camera-home" ? "Camera 1" : "Camera 2"}
      >
        <header>
          <div>
            <p>{cameraRole === "camera-home" ? "CAMERA 1" : "CAMERA 2"}</p>
            <h1>Portrait camera</h1>
          </div>
          <span>
            {metrics?.direct && previewReady
              ? "Connected"
              : previewReady
                ? "Connecting"
                : "Not connected"}
          </span>
        </header>
        <div className="phone-camera-frame">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="Complete local camera frame"
          />
          {!previewReady && (
            <div className="phone-camera-guide" aria-hidden="true">
              <div className="phone-camera-house">
                <div />
              </div>
              <div className="phone-camera-line" />
            </div>
          )}
        </div>
        <button
          className="btn phone-camera-connect"
          disabled={busy}
          onClick={() => {
            if (previewReady) {
              cleanup("Phone disconnected");
              setMetrics(undefined);
              setStatus("Phone disconnected. Connect again when ready.");
            } else
              void run(async () => {
                if (invitation.current) await claim();
                await connect();
              });
          }}
        >
          {busy
            ? "Connecting…"
            : previewReady
              ? "Disconnect phone"
              : "Connect phone"}
        </button>
        <p role="status" aria-live="polite">
          {status}
        </p>
        {warning && <p role="alert">{warning}</p>}
        {previewReady && (
          <details className="phone-camera-zoom">
            <summary>Zoom</summary>
            {zoomRange ? (
              <label>
                Zoom {zoom.toFixed(1)}×
                <input
                  aria-label="Hardware zoom"
                  type="range"
                  min={zoomRange.min}
                  max={zoomRange.max}
                  step={zoomRange.step}
                  value={zoom}
                  onChange={(e) => void updateZoom(Number(e.target.value))}
                />
              </label>
            ) : (
              <p>This phone does not offer camera zoom in this browser.</p>
            )}
          </details>
        )}
        <p className="phone-camera-hint">
          Keep the phone upright, on the same Wi-Fi as Studio, and leave this
          page open.
        </p>
      </main>
    );
  return (
    <section
      aria-label={cameraRole === "camera-home" ? "Camera 1" : "Camera 2"}
      className="mx-auto max-w-4xl space-y-4 p-4"
    >
      <h2 className="text-3xl font-bold">
        {side === "receiver" ? "PC receiver · " : ""}
        {cameraRole === "camera-home" ? "Camera 1" : "Camera 2"}
      </h2>
      <p>
        Keep your phone upright and on the same Wi-Fi as the recording PC. Leave
        this page open while filming.
      </p>
      <p role="status" aria-live="polite" className="panel">
        {status}
      </p>
      {warning && <p role="alert">{warning}</p>}
      {side === "receiver" && (
        <section className="panel space-y-3">
          <p>
            {timedTest ||
              "Overnight test: save checkpoints locally and stop automatically after two and a half hours. A connection failure ends the test early."}
          </p>
          <button
            className="btn"
            disabled={
              !metrics?.direct ||
              Boolean(recorder.current) ||
              !connection.current
            }
            onClick={startTimedTest}
          >
            Start 2.5-hour test
          </button>{" "}
          <button className="btn-secondary" onClick={exportTimedTest}>
            Download timed-test results
          </button>
        </section>
      )}
      <div className="flex flex-wrap gap-3">
        {side === "receiver" ? (
          <>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void run(register)}
            >
              Register PC
            </button>
            <button
              className="btn-secondary"
              disabled={busy || !session}
              onClick={() => void run(invite)}
            >
              Create camera invitation
            </button>
            <button
              className="btn"
              disabled={busy || !session}
              onClick={() => void run(connect)}
            >
              Connect receiver
            </button>
          </>
        ) : (
          <>
            {!claimed && (
              <button
                className="btn-secondary"
                disabled={busy || claimed}
                onClick={() => void run(claim)}
              >
                Accept camera invitation
              </button>
            )}
            <button
              className="btn"
              disabled={busy || !claimed}
              onClick={() => void run(connect)}
            >
              Start camera
            </button>
          </>
        )}
        <button
          className="btn-secondary"
          onClick={() => {
            cleanup("Operator pressed Stop");
            setStatus("Capture and receiver stopped.");
            if (side === "receiver" && sessionRef.current) {
              void request({
                action: "stop",
                side,
                sessionId: sessionRef.current,
              }).catch(() =>
                setStatus(
                  "Local receiver stopped. Server authority will expire within 30 seconds.",
                ),
              );
              setSession(undefined);
              sessionRef.current = undefined;
            }
          }}
        >
          Stop
        </button>
        {side === "receiver" && (
          <button
            className="btn-secondary"
            disabled={!metrics}
            onClick={exportEvidence}
          >
            Export aggregate evidence
          </button>
        )}
      </div>
      {qr && (
        <Image
          unoptimized
          src={qr}
          width={300}
          height={300}
          className="max-w-full"
          alt="One-use camera invitation QR code"
        />
      )}
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        controls={side === "receiver"}
        className="h-[45vh] w-full rounded-xl bg-black"
        style={{ objectFit: "contain" }}
        aria-label="Complete received camera frame"
      />
      {side === "receiver" && metrics && (
        <dl className="panel grid grid-cols-2 gap-2">
          <dt>Verified direct path</dt>
          <dd>{metrics.direct ? "Yes" : "No"}</dd>
          <dt>Offer received / answer sent</dt>
          <dd>
            {metrics.handshake?.offersReceived ?? 0} /{" "}
            {metrics.handshake?.answersSent ?? 0}
          </dd>
          <dt>Return messages / accepted / expired</dt>
          <dd>
            {metrics.signaling?.received ?? 0} /{" "}
            {metrics.signaling?.accepted ?? 0} /{" "}
            {metrics.signaling?.expired ?? 0}
          </dd>
          <dt>Connection / ICE</dt>
          <dd>
            {metrics.connectionState ?? "new"} /{" "}
            {metrics.iceConnectionState ?? "new"}
          </dd>
          <dt>Clock check v1</dt>
          <dd>
            {metrics.timing?.clock ?? "waiting"}; remaining{" "}
            {metrics.timing?.remainingMs ?? "—"} ms; round trip{" "}
            {metrics.timing?.roundTripMs ?? "—"} ms
          </dd>
          <dt>Relay bytes</dt>
          <dd>{metrics.relayBytes}</dd>
          <dt>Received bytes</dt>
          <dd>{metrics.bytesReceived}</dd>
          <dt>Decoded frames</dt>
          <dd>{metrics.framesDecoded}</dd>
          <dt>Frames per second</dt>
          <dd>{metrics.framesPerSecond}</dd>
          <dt>Video frame dimensions</dt>
          <dd>
            {frameSize.width && frameSize.height
              ? `${frameSize.width} × ${frameSize.height}`
              : "Not available yet"}
          </dd>
        </dl>
      )}
      {side === "receiver" && (
        <p>
          To reconnect after Wi-Fi loss: restart camera, then reconnect the
          receiver within 30 seconds. If the PC session expired, register it
          again first. Completing or closing the game, releasing camera, or
          replacing this PC session invalidates access. M2 acceptance still
          requires a physical two-and-a-half-hour test.
        </p>
      )}
    </section>
  );
}
