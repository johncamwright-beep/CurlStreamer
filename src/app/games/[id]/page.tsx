"use client";
import QRCode from "qrcode";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useGame } from "@/components/GameSync";
import type { Role } from "@/lib/types";
const roles: [Role, string][] = [
  ["camera-home", "Camera — Home End"],
  ["camera-away", "Camera — Away End"],
  ["scorer", "Scorekeeper + Audio"],
];
export default function GameLobby({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { game, error, act } = useGame(id);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [qr, setQr] = useState("");
  const [chooserUrl, setChooserUrl] = useState("");
  useEffect(() => {
    if (!game) return;
    const organizerToken = localStorage.getItem(`curlcast-access-${id}`);
    if (!organizerToken) return;
    void Promise.all(
      roles.map(async ([role]) => {
        const r = await fetch(`/api/games/${id}/invitations`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${organizerToken}`,
          },
          body: JSON.stringify({ role }),
        });
        const { token } = await r.json();
        return [
          role,
          `${location.origin}/join/${id}?token=${encodeURIComponent(token)}`,
        ] as const;
      }),
    ).then(async (pairs) => {
      const next = Object.fromEntries(pairs);
      setLinks(next);
      const chooserResponse = await fetch(`/api/games/${id}/invitations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${organizerToken}`,
        },
        body: JSON.stringify({ role: "chooser" }),
      });
      const chooser = await chooserResponse.json();
      const url = `${location.origin}/join/${id}?chooser=${encodeURIComponent(chooser.token)}`;
      setChooserUrl(url);
      setQr(await QRCode.toDataURL(url));
    });
  }, [game?.id, id]);
  if (error) return <main className="p-8">{error}</main>;
  if (!game) return <main className="p-8">Loading game…</main>;
  return (
    <main className="mx-auto max-w-5xl p-5">
      <p className="text-cyan-300">ORGANIZER · MOCK AUTH</p>
      <h1 className="text-4xl font-black">{game.config.eventName}</h1>
      <p className="text-slate-300">
        {game.config.homeName} vs {game.config.awayName} ·{" "}
        {game.config.scheduledEnds} ends
      </p>
      <div className="mt-6 grid gap-5 md:grid-cols-[240px_1fr]">
        <section className="panel text-center">
          <h2 className="font-bold">Open role chooser</h2>
          {qr ? (
            <img
              src={qr}
              alt="QR code for role chooser"
              className="mx-auto my-3 rounded-lg"
            />
          ) : (
            <div className="h-52" />
          )}
          <Link className="text-cyan-300 underline" href={chooserUrl || "#"}>
            Role chooser
          </Link>
        </section>
        <section className="panel">
          <h2 className="mb-4 text-xl font-bold">
            Direct, 30-minute invitation links
          </h2>
          <div className="grid gap-3">
            {roles.map(([role, label]) => (
              <a
                key={role}
                href={links[role] || "#"}
                className="btn-secondary flex items-center justify-between"
              >
                <span>{label}</span>
                <span
                  className={
                    game.claims[role] ? "text-amber-300" : "text-emerald-300"
                  }
                >
                  {game.claims[role] ? "Claimed" : "Available"}
                </span>
              </a>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link className="btn" href={`/score/${id}`}>
              Open scoring
            </Link>
            <Link className="btn-secondary" href={`/broadcast/${id}`}>
              Broadcast preview
            </Link>
            <button
              className="btn-secondary border-red-700 text-red-200"
              onClick={() =>
                confirm("Close this game and revoke participant access?") &&
                act({ type: "close-game" })
              }
            >
              Close game
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
