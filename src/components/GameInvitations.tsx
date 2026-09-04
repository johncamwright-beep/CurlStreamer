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
    <section className="panel mt-6" aria-busy={loading}>
      <h2 className="text-xl font-bold">Invite devices</h2>
      <div className="mt-3 grid items-start gap-5 md:grid-cols-[288px_1fr]">
        <div className="text-center">
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
              Open role chooser
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
        </div>
        {chooser && Object.keys(links).length === invitationRoles.length && (
          <details className="rounded-lg border border-slate-600 p-3">
            <summary className="flex min-h-11 cursor-pointer items-center font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
              Individual invitation links
            </summary>
            <p className="mb-3 text-sm text-slate-300">
              Advanced: each link claims one role and expires after 30 minutes.
            </p>
            <div className="grid gap-3">
              {invitationRoles.map(([role, label]) => (
                <a
                  key={role}
                  href={links[role]}
                  className="btn-secondary flex min-h-11 items-center justify-between focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                >
                  <span>{label}</span>
                  <span className="ml-3 text-cyan-200">
                    {claims[role] ? "Claimed" : "Invite"}
                  </span>
                </a>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
