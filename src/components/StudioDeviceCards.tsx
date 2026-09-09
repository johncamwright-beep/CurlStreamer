"use client";

import { organizerAccessToken } from "@/lib/access-session";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Role } from "@/lib/types";
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
}: {
  id: string;
  role: Role;
  label: string;
  claimed: boolean;
  enabled: boolean;
  onChanged?: () => Promise<unknown>;
  connectionStatus?: { receiverReady: boolean; phoneOnline: boolean };
}) {
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [largeQr, setLargeQr] = useState(false);
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
  const online = !scorer && claimed && connectionStatus?.phoneOnline;
  const stateLabel = scorer
    ? claimed
      ? "Assigned to a device"
      : "Ready to join"
    : !connectionStatus
      ? "Status unavailable"
      : online
        ? "Phone connected"
        : !connectionStatus.receiverReady
          ? "Studio offline"
          : claimed
            ? "Waiting for phone"
            : "Ready to connect";
  return (
    <section className="studio-device" aria-label={label} aria-busy={busy}>
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
      {claimed ? (
        <>
          {!online && (
            <p>
              {scorer
                ? "Open scoring on the assigned phone or tablet to continue."
                : "Reopen the camera page on the original phone and keep it in the foreground."}
            </p>
          )}
          <p className="studio-device-help">
            {scorer
              ? "Assignment does not confirm a live connection."
              : connectionStatus
                ? connectionStatus.phoneOnline
                  ? "Phone is connected to this game."
                  : connectionStatus.receiverReady
                    ? "Studio is ready. Reconnect this phone or release it to use another."
                    : "Start Studio recording for this game to reconnect."
                : "Connection status unavailable · assignment retained"}
          </p>
          {reconnect && !online && (
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
              className="studio-device-action"
              disabled={busy || !enabled}
              onClick={() => void showReconnect()}
            >
              {busy ? "Preparing…" : "Show reconnect QR"}
            </button>
          )}
          {!scorer &&
            onChanged &&
            (confirmRelease ? (
              <div>
                <p>Release this camera? Its saved access will stop working.</p>
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
                className="studio-device-action secondary"
                disabled={busy}
                onClick={() => setConfirmRelease(true)}
              >
                Release camera
              </button>
            ))}
        </>
      ) : (
        <>
          <p>
            {scorer
              ? "Score from a phone or tablet. Changes appear in this game."
              : "Use your phone’s camera to scan the code, then allow camera access."}
          </p>
          {active && (
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
                {Math.max(1, Math.ceil((invitation.expires - now) / 60000))} min
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
            className="studio-device-action"
            disabled={busy || !enabled}
            onClick={() => void showQr()}
          >
            {busy
              ? "Creating QR code…"
              : active
                ? "Refresh QR code"
                : error
                  ? "Try again"
                  : "Show QR code"}
          </button>
        </>
      )}
    </section>
  );
}

export function StudioDeviceCards({
  id,
  claims,
  enabled,
  onChanged,
}: {
  id: string;
  claims: Partial<Record<Role, string>>;
  enabled: boolean;
  onChanged?: () => Promise<unknown>;
}) {
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
          connectionStatus={connections?.[role]}
        />
      ))}
    </div>
  );
}
