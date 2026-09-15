"use client";

import { organizerAccessToken } from "@/lib/access-session";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Role, GameState, Layout } from "@/lib/types";
import { cameraIsShown, toggleCameraLayout } from "@/lib/camera-layout";
import { invitationRoles, issueInvitation } from "./GameInvitations";
import "./studio-devices.css";

function DeviceCard({
  id,
  role,
  label,
  claimed,
  enabled,
  onChanged,
  connectionStatus,
  micEnabled,
  micVolume = 1,
  onAudio,
  shown,
  onVisibility,
  layoutBusy,
}: {
  id: string;
  role: Role;
  label: string;
  claimed: boolean;
  enabled: boolean;
  onChanged?: () => Promise<unknown>;
  micEnabled?: boolean;
  micVolume?: number;
  shown?: boolean;
  layoutBusy?: boolean;
  onVisibility?: () => Promise<unknown>;
  onAudio?: (
    role: "camera-home" | "camera-away",
    enabled: boolean,
    volume?: number,
  ) => Promise<unknown>;
  connectionStatus?: {
    receiverReady: boolean;
    phoneOnline: boolean;
    videoReceiving?: boolean;
  };
}) {
  const [volumeDraft, setVolumeDraft] = useState(Math.round(micVolume * 100));
  useEffect(() => setVolumeDraft(Math.round(micVolume * 100)), [micVolume]);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [largeQr, setLargeQr] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  useEffect(() => {
    if (connectionStatus?.videoReceiving) {
      setQrOpen(false);
      setLargeQr(false);
    }
  }, [connectionStatus?.videoReceiving]);
  async function releaseCamera() {
    if (busy || role === "scorer" || !onChanged) return;
    setBusy(true);
    setError("");
    try {
      const token = organizerAccessToken(localStorage, id);
      const response = await fetch("/api/games/" + id + "/release-camera", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) throw Error();
      const result = await response.json();
      setReconnect(undefined);
      setConfirmRelease(false);
      await onChanged();
      if (result.providerCleanup?.status === "failed")
        setError(
          "Assignment released. The old phone may take a moment to disconnect.",
        );
    } catch {
      setError("Could not confirm release. Refresh the game and try again.");
    } finally {
      setBusy(false);
    }
  }
  const [invitation, setInvitation] = useState<{
    url: string;
    image: string;
    expires: number;
  }>();
  const [now, setNow] = useState(Date.now());
  const [reconnect, setReconnect] = useState<{ url: string; image: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setReconnect(undefined);
    if (claimed || !enabled) {
      request.current?.abort();
      request.current = null;
      setInvitation(undefined);
      setBusy(false);
      setError("");
    }
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [claimed, enabled]);
  useEffect(() => {
    if (!invitation) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [invitation]);
  async function showReconnect() {
    if (!claimed || !enabled || request.current) return;
    if (reconnect) {
      setQrOpen(!qrOpen);
      return;
    }
    setQrOpen(true);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      // This is only a page address. The original device must still present
      // its existing scoped session; it grants no access or reassignment.
      const url = new URL(
        role === "scorer"
          ? "/score/" + id
          : "/studio-m2/" + id + "/camera/" + role,
        location.origin,
      ).href;
      const image = await QRCode.toDataURL(url, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      if (request.current === controller && !controller.signal.aborted)
        setReconnect({ url, image });
    } catch {
      if (request.current === controller)
        setError("Could not display the reconnect code. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  async function showQr() {
    if (request.current || claimed || !enabled) return;
    if (invitation && Date.now() < invitation.expires) {
      setQrOpen(!qrOpen);
      return;
    }
    setQrOpen(true);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setInvitation(undefined);
    try {
      const token =
        localStorage.getItem("curlcast-organizer-access-" + id) ||
        localStorage.getItem("curlcast-access-" + id);
      const result = z
        .object({ url: z.url(), expiresAt: z.iso.datetime() })
        .parse(await issueInvitation(id, role, token, controller.signal));
      const url = new URL(result.url);
      const expires = Date.parse(result.expiresAt);
      if (
        url.origin !== location.origin ||
        url.pathname !== "/join/" + id ||
        url.username ||
        url.password ||
        expires <= Date.now()
      )
        throw new Error("Create a new QR code and try again.");
      const image = await QRCode.toDataURL(url.href, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#071320", light: "#ffffff" },
      });
      if (request.current !== controller || controller.signal.aborted) return;
      setNow(Date.now());
      setInvitation({ url: url.href, image, expires });
    } catch {
      if (request.current === controller && !controller.signal.aborted)
        setError(
          "Could not create a QR code. Check your connection and try again.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  const active = invitation && now < invitation.expires && !claimed && enabled;
  const scorer = role === "scorer";
  const online = !scorer && claimed && connectionStatus?.videoReceiving;
  const stateLabel = scorer
    ? claimed
      ? "Assigned to a device"
      : "Ready to join"
    : !connectionStatus
      ? "Status unavailable"
      : online
        ? "Receiving video"
        : connectionStatus.phoneOnline
          ? "Phone online · Waiting for video"
          : !connectionStatus.receiverReady
            ? "Studio offline"
            : claimed
              ? "Waiting for phone"
              : "Ready to connect";
  return (
    <section
      className="studio-device"
      data-scorer={scorer}
      aria-label={label}
      aria-busy={busy}
    >
      <header>
        <span className="studio-device-number" aria-hidden="true">
          {scorer ? "S" : role === "camera-home" ? "1" : "2"}
        </span>
        <div>
          <h2>{label}</h2>
          <p
            className="studio-device-state"
            role="status"
            data-online={Boolean(online)}
          >
            {stateLabel}
          </p>
        </div>
      </header>
      {role !== "scorer" && onAudio && claimed && (
        <div className="studio-device-mic-controls">
          <button
            className="studio-device-action secondary"
            aria-pressed={micEnabled === true}
            disabled={busy || !enabled}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onAudio(role, !micEnabled);
              } catch {
                setError("Could not change the phone microphone. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {micEnabled ? "Turn mic off" : "Turn mic on"}
          </button>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            Mic volume
            <input
              type="range"
              aria-label={label + " mic volume"}
              min="0"
              max="100"
              step="5"
              value={volumeDraft}
              onChange={(e) => setVolumeDraft(Number(e.target.value))}
              className="min-h-11 min-w-0 flex-1"
              disabled={busy || !enabled}
              onPointerUp={async (e) => {
                const volume = Number(e.currentTarget.value) / 100;
                setBusy(true);
                setError("");
                try {
                  await onAudio(role, micEnabled === true, volume);
                } catch {
                  setVolumeDraft(Math.round(micVolume * 100));
                  setError("Could not change mic volume. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
              onKeyUp={async (e) => {
                if (
                  ![
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                  ].includes(e.key)
                )
                  return;
                try {
                  await onAudio(
                    role,
                    micEnabled === true,
                    Number(e.currentTarget.value) / 100,
                  );
                } catch {
                  setVolumeDraft(Math.round(micVolume * 100));
                  setError("Could not change mic volume. Try again.");
                }
              }}
            />
          </label>
        </div>
      )}
      <div className="studio-device-actions">
        {!scorer && onVisibility && (
          <button
            className="studio-device-action secondary studio-device-visibility"
            aria-pressed={shown}
            disabled={busy || layoutBusy || !enabled}
            onClick={async () => {
              setError("");
              try {
                await onVisibility();
              } catch {
                setError("Could not change the broadcast picture. Try again.");
              }
            }}
          >
            {shown ? "Hide camera" : "Show camera"}
          </button>
        )}
        {claimed ? (
          <>
            {scorer && (
              <p>
                {scorer
                  ? "Open scoring on the assigned phone or tablet to continue."
                  : "Reopen the camera page on the original phone and keep it in the foreground."}
              </p>
            )}
            {!online && (
              <p className="studio-device-help">
                {scorer
                  ? "Assignment does not confirm a live connection."
                  : connectionStatus
                    ? connectionStatus.phoneOnline
                      ? "The phone has checked in. Video has not been confirmed on this screen."
                      : connectionStatus.receiverReady
                        ? "Studio is ready. Reconnect this phone or release it to use another."
                        : "Open this game in Studio to connect cameras."
                    : "Connection status unavailable · assignment retained"}
              </p>
            )}
            {reconnect && !online && qrOpen && (
              <div className="studio-device-qr" data-large={largeQr}>
                <button
                  className="studio-qr-size"
                  onClick={() => setLargeQr(!largeQr)}
                  aria-label={largeQr ? "Shrink QR code" : "Enlarge QR code"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={reconnect.image}
                    alt={label + " reconnect QR code"}
                    width={240}
                    height={240}
                  />
                </button>
                <p>
                  Use the original device and browser. This code does not grant
                  access to a different device.
                </p>
                <a href={reconnect.url}>Open reconnect page</a>
              </div>
            )}
            {error && <p role="alert">{error}</p>}
            {!online && (
              <button
                className="studio-device-action studio-device-connect"
                aria-label={
                  busy
                    ? "Preparing…"
                    : reconnect && qrOpen
                      ? "Hide QR code"
                      : "Show reconnect QR"
                }
                disabled={busy || !enabled}
                onClick={() => void showReconnect()}
              >
                {busy
                  ? "Preparing…"
                  : reconnect && qrOpen
                    ? "Hide QR code"
                    : "Reconnect QR"}
              </button>
            )}
            {!scorer &&
              onChanged &&
              (confirmRelease ? (
                <div className="studio-device-release-confirm">
                  <p>
                    Release this camera? Its saved access will stop working.
                  </p>
                  <button
                    className="studio-device-action"
                    disabled={busy}
                    onClick={() => void releaseCamera()}
                  >
                    Confirm release
                  </button>
                  <button
                    className="studio-device-action secondary"
                    disabled={busy}
                    onClick={() => setConfirmRelease(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="studio-device-action secondary studio-device-release"
                  disabled={busy}
                  onClick={() => setConfirmRelease(true)}
                >
                  Release camera
                </button>
              ))}
          </>
        ) : (
          <>
            {scorer && (
              <p>
                {scorer
                  ? "Score from a phone or tablet. Changes appear in this game."
                  : "Use your phone’s camera to scan the code, then allow camera access."}
              </p>
            )}
            {active && qrOpen && (
              <div className="studio-device-qr" data-large={largeQr}>
                <button
                  className="studio-qr-size"
                  onClick={() => setLargeQr(!largeQr)}
                  aria-label={largeQr ? "Shrink QR code" : "Enlarge QR code"}
                >
                  {/* Generated in memory; never stored in a profile or sent to an image service. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={invitation.image}
                    alt={label + " join QR code"}
                    width={240}
                    height={240}
                  />
                </button>
                <p>Scan to connect · Tap code to enlarge</p>
                <p>
                  Expires in{" "}
                  {Math.max(1, Math.ceil((invitation.expires - now) / 60000))}{" "}
                  min
                </p>
                <details>
                  <summary>Open without scanning</summary>
                  <a href={invitation.url}>
                    Open {label.toLowerCase()} invitation
                  </a>
                </details>
              </div>
            )}
            {invitation && !active && (
              <p role="status">QR code expired. Create a new one below.</p>
            )}
            {error && <p role="alert">{error}</p>}
            <button
              className="studio-device-action studio-device-connect"
              disabled={busy || !enabled}
              onClick={() => void showQr()}
            >
              {busy
                ? "Creating QR code…"
                : active
                  ? qrOpen
                    ? "Hide QR code"
                    : "Show QR code"
                  : error
                    ? "Try again"
                    : "Show QR code"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function StudioDeviceCards({
  id,
  claims,
  enabled,
  onChanged,
  cameraAudio,
  onAudio,
  layout,
  onLayout,
}: {
  id: string;
  claims: Partial<Record<Role, string>>;
  enabled: boolean;
  onChanged?: () => Promise<unknown>;
  cameraAudio?: GameState["cameraAudio"];
  layout?: Layout;
  onLayout?: (layout: Layout) => Promise<unknown>;
  onAudio?: (
    role: "camera-home" | "camera-away",
    enabled: boolean,
    volume?: number,
  ) => Promise<unknown>;
}) {
  const layoutFlight = useRef(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  async function toggleVisibility(camera: "home" | "away") {
    if (layoutFlight.current || !onLayout || !layout) return;
    layoutFlight.current = true;
    setLayoutBusy(true);
    try {
      await onLayout(toggleCameraLayout(layout, camera));
    } finally {
      layoutFlight.current = false;
      setLayoutBusy(false);
    }
  }
  const [received, setReceived] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let expiry: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      const parsed = z
        .object({
          gameId: z.literal(id),
          cameras: z.record(z.string(), z.boolean()),
        })
        .safeParse((event as CustomEvent).detail);
      if (!parsed.success) return;
      setReceived(parsed.data.cameras);
      clearTimeout(expiry);
      expiry = setTimeout(() => setReceived({}), 6000);
    };
    window.addEventListener("studio-camera-status", receive);
    return () => {
      clearTimeout(expiry);
      window.removeEventListener("studio-camera-status", receive);
    };
  }, [id]);
  const [connections, setConnections] =
    useState<
      Record<string, { receiverReady: boolean; phoneOnline: boolean }>
    >();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const token = organizerAccessToken(localStorage, id);
        const response = await fetch("/api/games/" + id + "/studio-devices", {
          headers: token ? { authorization: "Bearer " + token } : {},
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw Error();
        const parsed = z
          .object({
            cameras: z.record(
              z.string(),
              z.object({
                receiverReady: z.boolean(),
                phoneOnline: z.boolean(),
              }),
            ),
          })
          .parse(await response.json());
        if (!cancelled) setConnections(parsed.cameras);
      } catch {
        if (!cancelled) setConnections(undefined);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, enabled]);
  return (
    <div className="studio-device-grid">
      {invitationRoles.map(([role, label]) => (
        <DeviceCard
          key={id + role + (claims[role] ?? "")}
          id={id}
          role={role}
          label={role === "scorer" ? "Remote scorer" : label}
          claimed={Boolean(claims[role])}
          enabled={enabled}
          onChanged={onChanged}
          micEnabled={role !== "scorer" && cameraAudio?.[role]?.enabled}
          micVolume={
            role !== "scorer" ? cameraAudio?.[role]?.volume : undefined
          }
          onAudio={onAudio}
          shown={
            layout && role !== "scorer"
              ? cameraIsShown(layout, role === "camera-home" ? "home" : "away")
              : undefined
          }
          layoutBusy={layoutBusy}
          onVisibility={
            onLayout && role !== "scorer"
              ? () => toggleVisibility(role === "camera-home" ? "home" : "away")
              : undefined
          }
          connectionStatus={
            connections?.[role]
              ? { ...connections[role], videoReceiving: received[role] }
              : undefined
          }
        />
      ))}
    </div>
  );
}
