"use client";

import QRCode from "qrcode";
import React from "react";
import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/lib/types";

export const invitationRoles: [Role, string][] = [
  ["camera-home", "Camera 1"],
  ["camera-away", "Camera 2"],
  ["scorer", "Scorekeeper + Audio"],
];

type Invitation = { url: string; expiresAt: string };

async function issueInvitation(
  id: string,
  role: Role | "chooser",
  token: string | null,
) {
  const response = await fetch(`/api/games/${id}/invitations`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ role }),
  });
  const result = (await response.json().catch(() => null)) as
    (Invitation & { error?: string }) | null;
  if (!response.ok || !result?.url || !result.expiresAt)
    throw new Error(result?.error || "Invitation links are unavailable.");
  return result;
}

export function GameInvitations({
  id,
  enabled,
  claims,
}: {
  id: string;
  enabled: boolean;
  claims: Partial<Record<Role, string>>;
}) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [chooser, setChooser] = useState<Invitation>();
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const regenerate = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError("");
    setLinks({});
    setChooser(undefined);
    setQr("");
    try {
      const organizerToken =
        localStorage.getItem(`curlcast-organizer-access-${id}`) ||
        localStorage.getItem(`curlcast-access-${id}`);
      const [nextChooser, ...direct] = await Promise.all([
        issueInvitation(id, "chooser", organizerToken),
        ...invitationRoles.map(([role]) =>
          issueInvitation(id, role, organizerToken),
        ),
      ]);
      const image = await QRCode.toDataURL(nextChooser.url, {
        width: 256,
        margin: 2,
        color: { dark: "#020617", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      setLinks(
        Object.fromEntries(
          invitationRoles.map(([role], index) => [role, direct[index].url]),
        ),
      );
      setChooser(nextChooser);
      setQr(image);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Invitation links are unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled, id]);

  useEffect(() => {
    void regenerate();
  }, [regenerate]);

  return (
    <div className="mt-6 grid gap-5 md:grid-cols-[288px_1fr]">
      <section className="panel text-center" aria-busy={loading}>
        <h2 className="font-bold">Open role chooser</h2>
        {qr && chooser ? (
          // The QR library produces a short-lived client-side data URL, not an optimizable asset.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="QR code to open the role chooser"
            width={256}
            height={256}
            className="mx-auto my-3 rounded-lg bg-white"
          />
        ) : (
          <div className="my-3 flex min-h-64 items-center justify-center rounded-lg border border-slate-600 bg-slate-950 p-4">
            <p role={error ? "alert" : "status"} className="text-slate-300">
              {error ||
                (loading
                  ? "Creating secure invitation…"
                  : "Invitation unavailable.")}
            </p>
          </div>
        )}
        {chooser && qr && (
          <a
            className="inline-flex min-h-11 items-center text-cyan-300 underline"
            href={chooser.url}
          >
            Role chooser
          </a>
        )}
        {chooser && (
          <p className="mt-2 text-sm text-slate-300">
            Expires {new Date(chooser.expiresAt).toLocaleString()}
          </p>
        )}
        <button
          className="btn-secondary mt-3 w-full"
          disabled={loading}
          onClick={() => void regenerate()}
        >
          {chooser ? "Regenerate invitation" : "Retry invitation"}
        </button>
      </section>
      <section className="panel">
        <h2 className="mb-4 text-xl font-bold">
          Direct, 30-minute invitation links
        </h2>
        <div className="grid gap-3">
          {invitationRoles.map(([role, label]) => (
            <a
              key={role}
              href={links[role]}
              aria-disabled={!links[role]}
              className="btn-secondary flex min-h-11 items-center justify-between aria-disabled:pointer-events-none aria-disabled:opacity-50"
            >
              <span>{label}</span>
              <span className="ml-3 text-cyan-200">
                {claims[role] ? "Claimed" : "Available"}
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
