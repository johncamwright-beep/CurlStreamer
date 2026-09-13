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
import { shouldApplyCameraZoomCommand } from "@/lib/camera-zoom-command";
import type { CameraAudioStatus } from "@/lib/types";
import { cameraAudioEnabled } from "@/lib/camera-audio";
import { selectPhoneAudioTrack } from "@/lib/phone-audio-track";

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
  const zoomCommand = useRef<string | undefined>(undefined);
  const zoomReportFlight = useRef(false);
  const zoomCaptureStartedAt = useRef(0);
  async function reportZoom(range?: ZoomRange, value?: number) {
    if (side !== "camera" || zoomReportFlight.current) return;
    zoomReportFlight.current = true;
    const token = cameraPublishAccessToken(localStorage, id, cameraRole);
    try {
      const response = await fetch(`/api/games/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          range
            ? {
                type: "camera-zoom-status",
                role: cameraRole,
                supported: true,
                ...range,
                value: value ?? range.min,
              }
            : {
                type: "camera-zoom-status",
                role: cameraRole,
                supported: false,
              },
        ),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw Error("zoom status rejected");
    } finally {
      zoomReportFlight.current = false;
    }
  }
  async function updateZoom(value: number) {
    const current = track.current;
    if (!current || !zoomRange || zoomFlight.current) return false;
    zoomFlight.current = true;
    try {
      const next = clampZoom(value, zoomRange);
      await current.applyConstraints({
        advanced: [{ zoom: next } as MediaTrackConstraintSet],
      });
      if (current === track.current)
        setZoom(current.getSettings().zoom ?? next);
      if (current === track.current)
        void reportZoom(zoomRange, current.getSettings().zoom ?? next).catch(
          () => setWarning("Could not report camera zoom capability."),
        );
      return current === track.current;
    } catch {
      setWarning("This phone could not adjust zoom.");
      return false;
    } finally {
      zoomFlight.current = false;
    }
  }
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | undefined>(undefined);
  const connection = useRef<
    | {
        stop: () => void;
        replaceAudioTrack: (track: MediaStreamTrack | null) => Promise<void>;
      }
    | undefined
  >(undefined);
  const audioTrack = useRef<MediaStreamTrack | undefined>(undefined);
  // The first Connect gesture establishes permission for both devices. Keep the
  // microphone track disabled and local until Studio authorizes publication.
  const warmAudioTrack = useRef<MediaStreamTrack | undefined>(undefined);
  const audioIntent = useRef(false);
  const audioFlight = useRef(false);
  const audioAttemptBlocked = useRef(false);
  const audioPollFlight = useRef(false);
  const audioStatusRef = useRef<CameraAudioStatus>("off");
  const [audioStatus, setAudioStatus] = useState<CameraAudioStatus>("off");
  const [audioConnectionVersion, setAudioConnectionVersion] = useState(0);
  const wake = useRef<OptionalScreenWakeLock | undefined>(undefined);
  const epoch = useRef(0);
  const setupAbort = useRef<AbortController | undefined>(undefined);
  const active = useRef(false);
  const recorder = useRef<EnduranceRecorder | undefined>(undefined);
  const latestTimed = useRef<string | undefined>(undefined);
  const metricsAt = useRef<number | undefined>(undefined);
  const [timedTest, setTimedTest] = useState("");
  const failure = useRef("");
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const retryCount = useRef(0);
  const mounted = useRef(true);
  const recoverable = useRef(false);
  function recover() {
    if (
      !mounted.current ||
      side !== "camera" ||
      !recoverable.current ||
      retryCount.current >= 6
    )
      return;
    const delay = Math.min(10000, 2000 * ++retryCount.current);
    setStatus("Connection interrupted. Reconnecting to Studio…");
    retryTimer.current = setTimeout(() => void run(connect), delay);
  }
  const stage = useRef("operation");
  const sessionRef = useRef<string | undefined>(undefined);
  const [session, setSession] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    side === "receiver"
      ? "Register this PC, then pair camera."
      : "Open this game in Studio, then connect your phone.",
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

  async function reportAudio(
    status: CameraAudioStatus,
    reportEpoch = epoch.current,
  ) {
    if (side !== "camera") return;
    if (reportEpoch !== epoch.current) return;
    audioStatusRef.current = status;
    setAudioStatus(status);
    const token = cameraPublishAccessToken(localStorage, id, cameraRole);
    const response = await fetch(`/api/games/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        type: "camera-audio-status",
        role: cameraRole,
        status,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw Error("microphone status rejected");
  }
  async function disableAudio(report = true) {
    const audioEpoch = epoch.current;
    const current = audioTrack.current;
    audioTrack.current = undefined;
    if (current) {
      // Mute immediately; cleanup can now find the retained track even while
      // replaceTrack is awaiting the browser.
      current.enabled = false;
      if (warmAudioTrack.current !== current) warmAudioTrack.current?.stop();
      warmAudioTrack.current = current;
      try {
        await connection.current?.replaceAudioTrack(null);
      } catch {
        // The video session may already be stopping. Always release the device track.
      }
    }
    if (
      report &&
      audioEpoch === epoch.current &&
      audioStatusRef.current !== "off"
    )
      void reportAudio("off").catch(() => undefined);
  }
  function releaseAudio() {
    const published = audioTrack.current;
    const warm = warmAudioTrack.current;
    audioTrack.current = undefined;
    warmAudioTrack.current = undefined;
    published?.stop();
    if (warm && warm !== published) warm.stop();
  }
  async function synchronizeAudio(fromGesture = false) {
    if (
      side !== "camera" ||
      audioFlight.current ||
      (audioAttemptBlocked.current && !fromGesture)
    )
      return;
    if (!audioIntent.current) {
      await disableAudio();
      return;
    }
    // A published warm track remains authoritative across polling cycles. Do
    // not request or replace it again until it ends or Studio disables it.
    const selected = selectPhoneAudioTrack(
      audioTrack.current,
      warmAudioTrack.current,
    );
    if (selected.alreadyPublished) return;
    if (!connection.current) return;
    audioFlight.current = true;
    const audioEpoch = epoch.current;
    let next = selected.track;
    if (!next && warmAudioTrack.current?.readyState !== "live") {
      warmAudioTrack.current = undefined;
    }
    // iOS requires this call itself to be in the button's activation stack.
    const acquisition =
      fromGesture && !next
        ? navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        : undefined;
    try {
      await reportAudio("pending", audioEpoch).catch(() => undefined);
      const stream = next
        ? undefined
        : await (acquisition ??
            navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
      next ??= stream?.getAudioTracks()[0];
      if (!next) throw Error("No microphone track was returned.");
      if (audioEpoch !== epoch.current || !connection.current) {
        next.stop();
        return;
      }
      if (!audioIntent.current) {
        next.enabled = false;
        warmAudioTrack.current = next;
        return;
      }
      const audioConnection = connection.current;
      next.enabled = true;
      await audioConnection.replaceAudioTrack(next);
      if (audioEpoch !== epoch.current) {
        next.stop();
        return;
      }
      if (!audioIntent.current) {
        next.enabled = false;
        warmAudioTrack.current = next;
        await audioConnection.replaceAudioTrack(null).catch(() => undefined);
        return;
      }
      warmAudioTrack.current = undefined;
      audioTrack.current = next;
      // A failed status update must not tear down an already working media track.
      await reportAudio("active").catch(() => undefined);
    } catch (error) {
      if (next && next === warmAudioTrack.current) next.enabled = false;
      else next?.stop();
      if (audioEpoch !== epoch.current || !audioIntent.current) return;
      const name = error instanceof DOMException ? error.name : "";
      audioAttemptBlocked.current = true;
      await reportAudio(
        name === "NotAllowedError" ? "permission-required" : "error",
        audioEpoch,
      ).catch(() => undefined);
    } finally {
      audioFlight.current = false;
    }
  }

  const request = async (
    body: Omit<Parameters<StudioRequest>[0], "cameraRole">,
  ) => {
    const requestEpoch = epoch.current;
    recoverable.current = false;
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
    }).catch((error: unknown) => {
      if (requestEpoch === epoch.current) recoverable.current = true;
      throw error;
    });
    const value = await result.json().catch(() => null);
    if (!result.ok) {
      recoverable.current =
        result.status >= 500 || value?.code === "studio_stale";
      if (requestEpoch === epoch.current)
        failure.current =
          side === "camera" && result.status === 409
            ? value?.code === "studio_stale"
              ? "Studio is reconnecting. Keep this game open on the PC, then tap Connect phone."
              : value?.code === "peer_stale"
                ? "This camera connection expired or was replaced. Close any other camera tabs on this phone, then tap Connect phone."
                : value?.code === "camera_released"
                  ? "This camera assignment was released or replaced. Scan a fresh camera QR code from the scoring screen."
                  : value?.code === "signal_limit"
                    ? "Too many connection attempts. Wait one minute, then tap Connect phone once."
                    : "Open this game in Studio and try again. If this camera was released, scan a fresh invitation."
            : side === "camera" &&
                (result.status === 401 || result.status === 403)
              ? "This camera no longer has access. Ask the organizer for a new camera QR code."
              : "Could not connect to Studio. Check your connection and try again.";
      throw Error("Studio request failed");
    }
    return value;
  };
  function cleanup(reason = "Connection cleanup") {
    clearTimeout(retryTimer.current);
    recorder.current?.finish("interrupted", reason);
    epoch.current += 1;
    setupAbort.current?.abort();
    setupAbort.current = undefined;
    active.current = false;
    audioIntent.current = false;
    audioAttemptBlocked.current = false;
    audioStatusRef.current = "off";
    setAudioStatus("off");
    setPreviewReady(false);
    setZoomRange(undefined);
    zoomCommand.current = undefined;
    zoomCaptureStartedAt.current = 0;
    onReady?.(cameraRole, false);
    releaseAudio();
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
    mounted.current = true;
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
      mounted.current = false;
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
      recover();
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
      let microphoneDenied = false;
      const capture = (includeAudio: boolean) =>
        acquireRawPortraitCamera(
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
          includeAudio,
        );
      let acquired;
      try {
        // This is the Connect phone button's activation stack: ask for camera
        // and microphone together, then leave the mic unpublished until Studio
        // explicitly enables this camera role.
        acquired = await capture(true);
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          error.name !== "NotAllowedError"
        )
          throw error;
        microphoneDenied = true;
        // A declined microphone must not prevent a video-only broadcast.
        acquired = await capture(false);
      }
      if (attempt !== epoch.current) {
        acquired.track.stop();
        acquired.audioTrack?.stop();
        return;
      }
      // Permission is now established, but Studio retains publication control.
      // Keep this track locally disabled; it is only attached to WebRTC after
      // the remote camera-role intent becomes enabled.
      acquired.audioTrack && (acquired.audioTrack.enabled = false);
      warmAudioTrack.current?.stop();
      warmAudioTrack.current = acquired.audioTrack;
      setWarning(
        microphoneDenied
          ? "Microphone permission was declined. Video continues; enable it in Studio and grant microphone access to add audio."
          : (acquired.report.warning ?? ""),
      );
      setPreviewReady(true);
      const range =
        typeof acquired.track.getCapabilities === "function"
          ? hardwareZoomRange(acquired.track)
          : undefined;
      setZoomRange(range);
      const initialZoom = acquired.track.getSettings().zoom ?? range?.min ?? 1;
      zoomCaptureStartedAt.current = Date.now();
      setZoom(initialZoom);
      void reportZoom(range, initialZoom).catch(() =>
        setWarning("Could not report camera zoom capability."),
      );
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
        if (value.direct) retryCount.current = 0;
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
        if (
          /signaling disconnected|Signaling stopped|Studio authority expired/i.test(
            reason,
          )
        )
          recoverable.current = true;
        recover();
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
    setAudioConnectionVersion((value) => value + 1);
    setStatus("Connecting to Studio…");
  }
  useEffect(() => {
    if (side !== "camera" || !connection.current) return;
    let cancelled = false;
    const pollIntent = async () => {
      if (audioPollFlight.current) return;
      audioPollFlight.current = true;
      try {
        const token = cameraPublishAccessToken(localStorage, id, cameraRole);
        const response = await fetch(`/api/games/${id}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        });
        if (cancelled || !response.ok) return;
        const game = (await response.json().catch(() => null)) as
          Parameters<typeof cameraAudioEnabled>[0] | null;
        const enabled = game ? cameraAudioEnabled(game, cameraRole) : false;
        if (cancelled) return;
        const changed = enabled !== audioIntent.current;
        if (changed) {
          audioIntent.current = enabled;
          audioAttemptBlocked.current = false;
          if (enabled) void synchronizeAudio();
          else void disableAudio();
        }
      } catch {
        // A later poll can restore the scoped microphone intent.
      } finally {
        audioPollFlight.current = false;
      }
    };
    void pollIntent();
    const timer = setInterval(() => void pollIntent(), 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, side, cameraRole, audioConnectionVersion]);
  useEffect(() => {
    if (side !== "camera" || !zoomRange || !track.current) return;
    let cancelled = false;
    let checking = false;
    const checkCommand = async () => {
      if (checking || cancelled) return;
      checking = true;
      try {
        const token = cameraPublishAccessToken(localStorage, id, cameraRole);
        const response = await fetch(`/api/games/${id}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        });
        if (
          !response.ok ||
          cancelled ||
          effectEpoch !== epoch.current ||
          track.current !== effectTrack
        )
          return;
        const game = (await response.json().catch(() => null)) as {
          cameraZoom?: Partial<
            Record<
              typeof cameraRole,
              { command?: { id: string; value: number; requestedAt: number } }
            >
          >;
        } | null;
        const command = game?.cameraZoom?.[cameraRole]?.command;
        if (
          !command ||
          command.id === zoomCommand.current ||
          !shouldApplyCameraZoomCommand(
            command,
            zoomCaptureStartedAt.current,
          ) ||
          cancelled ||
          effectEpoch !== epoch.current ||
          track.current !== effectTrack
        )
          return;
        if (await updateZoom(command.value)) zoomCommand.current = command.id;
      } catch {
        // The next poll or local zoom report will recover; do not invent a zoom result.
      } finally {
        checking = false;
      }
    };
    const effectEpoch = epoch.current;
    const effectTrack = track.current;
    void checkCommand();
    const timer = setInterval(() => void checkCommand(), 2_000);
    const freshness = setInterval(() => {
      const current = track.current;
      if (current)
        void reportZoom(
          zoomRange,
          current.getSettings().zoom ?? zoomRange.min,
        ).catch(() => undefined);
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(freshness);
    };
  }, [id, side, cameraRole, zoomRange]);
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
        data-capturing={previewReady}
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
        {previewReady && (
          <section className="phone-camera-zoom" aria-label="Camera zoom">
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
              <p>Zoom is unavailable on this phone/browser.</p>
            )}
          </section>
        )}
        <button
          className="btn phone-camera-connect"
          disabled={busy}
          onClick={() => {
            retryCount.current = 0;
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
        {audioStatus === "permission-required" && (
          <button
            className="btn-secondary w-full"
            onClick={() => {
              audioAttemptBlocked.current = false;
              void synchronizeAudio(true);
            }}
          >
            Grant microphone permission
          </button>
        )}
        {audioIntent.current && (
          <p role="status">
            Microphone {audioStatus === "active" ? "on" : audioStatus}.
          </p>
        )}
        <p role="status" aria-live="polite">
          {status.startsWith("Path check stopped:")
            ? "Studio could not verify this phone’s connection. Reload this phone page, then tap Connect phone. Keep Studio open."
            : status}
        </p>
        {warning && <p role="alert">{warning}</p>}
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
