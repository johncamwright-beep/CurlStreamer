"use client";
import QRCode from "qrcode";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useGame } from "@/components/GameSync";
import type { Role } from "@/lib/types";
import { cameraDisplayStatus } from "@/lib/camera-status";
import { AppNavigation } from "@/components/AppNavigation";
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
  const [disconnecting, setDisconnecting] = useState<Role>();
  async function disconnectCamera(role: "camera-home" | "camera-away") {
    const side = role === "camera-home" ? "Home" : "Away";
    if (!confirm(`Disconnect the ${side} camera?`)) return;
    setDisconnecting(role);
    try {
      const token = localStorage.getItem(`curlcast-access-${id}`);
      const response = await fetch(`/api/games/${id}/disconnect-camera`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) throw new Error("Camera could not be disconnected.");
    } finally {
      setDisconnecting(undefined);
    }
  }
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
        const { url } = await r.json();
        return [role, url] as const;
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
      const url = chooser.url;
      setChooserUrl(url);
      setQr(await QRCode.toDataURL(url));
    });
  }, [game?.id, id]);
  if (error) return <main className="p-8">{error}</main>;
  if (!game) return <main className="p-8">Loading game…</main>;
  return (
    <main className="mx-auto max-w-5xl p-5">
      <div className="mb-4">
        <AppNavigation gameId={id} />
      </div>
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
              <div
                key={role}
                className="btn-secondary flex items-center justify-between"
              >
                <a href={links[role] || "#"} className="min-h-11 flex-1 py-2">
                  <span>{label}</span>
                  <span className="ml-3 text-cyan-200">
                    {role === "scorer"
                      ? game.claims[role]
                        ? "Claimed"
                        : "Available"
                      : cameraDisplayStatus(game, role)}
                  </span>
                  {role !== "scorer" && game.cameraHealth?.[role] && (
                    <small className="block text-slate-400">
                      {game.cameraHealth[role]?.diagnostic
                        ? `${game.cameraHealth[role]?.diagnostic} · `
                        : ""}
                      Updated{" "}
                      {new Date(
                        game.cameraHealth[role]!.updatedAt,
                      ).toLocaleTimeString()}
                    </small>
                  )}
                </a>
                {role !== "scorer" && game.claims[role] && (
                  <button
                    className="min-h-11 rounded-lg border border-red-700 px-3 text-red-200"
                    disabled={disconnecting === role}
                    onClick={() => void disconnectCamera(role)}
                  >
                    Disconnect Camera
                  </button>
                )}
              </div>
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
