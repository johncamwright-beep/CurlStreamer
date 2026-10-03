"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";
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
} from "@/lib/providers/studio-browser";
import { studioTicketSchema, type StudioSide } from "@/lib/studio-protocol";
import type { DirectMetrics } from "@/lib/providers/direct-peer";
import {
  EnduranceRecorder,
  enduranceStorageKey,
} from "@/lib/providers/endurance-recorder";

export function DirectMediaSpike({
  id,
  side,
}: {
  id: string;
  side: StudioSide;
}) {
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
      ? "Register this PC, then pair Camera 1."
      : "Claim Camera 1, then start the camera.",
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

  const request: StudioRequest = async (body) => {
    const requestEpoch = epoch.current;
    const token =
      side === "camera"
        ? cameraPublishAccessToken(localStorage, id, "camera-home")
        : organizerAccessToken(localStorage, id);
    const result = await fetch("/api/games/" + id + "/studio", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const value = await result.json().catch(() => null);
    if (!result.ok) {
      if (requestEpoch === epoch.current)
        failure.current = `Studio ${body.action} request failed (HTTP ${result.status}).`;
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
        setStatus(
          "New invitation received. Claim Camera 1 to replace the saved camera access.",
        );
      }
      setClaimed(
        !invitation.current &&
          Boolean(cameraPublishAccessToken(localStorage, id, "camera-home")),
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
    setStatus("PC registered. Create a Camera 1 invitation.");
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
      body: JSON.stringify({ role: "camera-home" }),
    });
    const value = await response.json();
    if (!response.ok || !value.token) throw Error();
    const url = new URL("/studio-spike/" + id + "/camera", location.origin);
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
    if (!response.ok || value.role !== "camera-home" || !value.sessionToken)
      throw Error();
    preserveAndStoreParticipantAccess(localStorage, id, value.sessionToken);
    invitation.current = undefined;
    setClaimed(true);
    setStatus("Camera 1 claimed. Keep the phone upright and start the camera.");
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
            ? "Direct path verified. Confirm the phone and PC are on the same router LAN."
            : "Waiting for a verified direct connection.",
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
    setStatus(
      "Private signaling connected. Waiting for the direct video path.",
    );
  }
  function exportEvidence() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            milestone: "M1",
            source: "browser aggregate statistics",
            physicalLanProof: "Requires operator confirmation",
            side,
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
    a.download = "m1-direct-metrics.json";
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
      latestTimed.current || localStorage.getItem(enduranceStorageKey(id));
    if (!saved) {
      setWarning("No saved timed-test data on this browser yet.");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([saved], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "m1-two-hour-test.json";
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
      save: (data) => localStorage.setItem(enduranceStorageKey(id), data),
      metrics: () => evidence.current.last,
      context: () => ({
        metricsAt: metricsAt.current,
        visibility: document.visibilityState,
        online: navigator.onLine,
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
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-3xl font-bold">
        M1 direct media spike ·{" "}
        {side === "receiver" ? "PC receiver" : "Camera 1"}
      </h1>
      <p>
        Disposable infrastructure test · one camera · video only. Keep both
        devices on the same router, with client isolation disabled. Keep the
        phone powered, upright, unlocked, and in the foreground.
      </p>
      <p role="status" aria-live="polite" className="panel">
        {status}
      </p>
      {warning && <p role="alert">{warning}</p>}
      {side === "receiver" && (
        <section className="panel space-y-3">
          <p>
            {timedTest ||
              "Overnight test: save checkpoints locally and stop automatically after two hours. A connection failure ends the test early."}
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
            Start 2-hour test
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
              Create Camera 1 invitation
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
            <button
              className="btn-secondary"
              disabled={busy || claimed}
              onClick={() => void run(claim)}
            >
              Claim Camera 1
            </button>
            <button
              className="btn"
              disabled={busy || !claimed}
              onClick={() => void run(connect)}
            >
              Start or reconnect camera
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
        <button
          className="btn-secondary"
          disabled={!metrics}
          onClick={exportEvidence}
        >
          Export aggregate evidence
        </button>
      </div>
      {qr && (
        <Image
          unoptimized
          src={qr}
          width={300}
          height={300}
          className="max-w-full"
          alt="One-use Camera 1 invitation QR code"
        />
      )}
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        controls
        className="h-[65vh] w-full rounded-xl bg-black"
        style={{ objectFit: "contain" }}
        aria-label={
          side === "camera"
            ? "Complete local camera frame"
            : "Complete received camera frame"
        }
      />
      {metrics && (
        <dl className="panel grid grid-cols-2 gap-2">
          <dt>Verified direct path</dt>
          <dd>{metrics.direct ? "Yes" : "No"}</dd>
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
      <p>
        To reconnect after Wi-Fi loss: restart Camera 1, then reconnect the
        receiver within 30 seconds. If the PC session expired, register it again
        first. Completing or closing the game, releasing Camera 1, or replacing
        this PC session invalidates access. M1 acceptance still requires a
        physical two-hour test.
      </p>
    </main>
  );
}
