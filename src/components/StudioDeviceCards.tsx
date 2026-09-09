"use client";

import Link from "next/link";
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
}: {
  id: string;
  role: Role;
  label: string;
  claimed: boolean;
  enabled: boolean;
}) {
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
  return (
    <section className="studio-device" aria-label={label} aria-busy={busy}>
      <header>
        <span className="studio-device-number" aria-hidden="true">
          {scorer ? "S" : role === "camera-home" ? "1" : "2"}
        </span>
        <div>
          <h2>{label}</h2>
          <p className="studio-device-state">
            {claimed ? "Assigned to a device" : "Ready to join"}
          </p>
        </div>
      </header>
      {claimed ? (
        <>
          <p>
            {scorer
              ? "Open scoring on the assigned phone or tablet to continue."
              : "Reopen the camera page on the original phone and keep it in the foreground."}
          </p>
          <p className="studio-device-help">
            Assignment does not confirm a live connection.
          </p>
          {reconnect && (
            <div className="studio-device-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={reconnect.image}
                alt={label + " reconnect QR code"}
                width={240}
                height={240}
              />
              <p>
                Use the original device and browser. This code does not grant
                access to a different device.
              </p>
              <a href={reconnect.url}>Open reconnect page</a>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            className="studio-device-action"
            disabled={busy || !enabled}
            onClick={() => void showReconnect()}
          >
            {busy ? "Preparing…" : "Show reconnect QR"}
          </button>
          <Link
            className="studio-device-action secondary"
            href={"/games/" + id}
          >
            Manage assignment
          </Link>
        </>
      ) : (
        <>
          <p>
            {scorer
              ? "Score from a phone or tablet. Changes appear in this game."
              : "Use your phone’s camera to scan the code, then allow camera access."}
          </p>
          {active && (
            <div className="studio-device-qr">
              {/* Generated in memory; never stored in a profile or sent to an image service. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={invitation.image}
                alt={label + " join QR code"}
                width={240}
                height={240}
              />
              <p>Scan on the device you want to join.</p>
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
}: {
  id: string;
  claims: Partial<Record<Role, string>>;
  enabled: boolean;
}) {
  return (
    <div className="studio-device-grid">
      {invitationRoles.map(([role, label]) => (
        <DeviceCard
          key={id + role}
          id={id}
          role={role}
          label={role === "scorer" ? "Remote scorer" : label}
          claimed={Boolean(claims[role])}
          enabled={enabled}
        />
      ))}
    </div>
  );
}
