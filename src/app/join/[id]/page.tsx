"use client";
import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGame } from "@/components/GameSync";
import { preserveAndStoreParticipantAccess } from "@/lib/access-session";
import type { Role } from "@/lib/types";
const roles: [Role, string, string][] = [
  ["camera-home", "Camera 1", "Video only"],
  ["camera-away", "Camera 2", "Video only"],
  ["scorer", "Scorekeeper + Audio", "Audio only"],
];
export default function Join({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const { game } = useGame(
    id,
    "join",
    search.get("chooser") ?? search.get("token"),
  );
  const router = useRouter();
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (search.get("token")) return;
    const chooser = search.get("chooser");
    if (!chooser) return;
    setError("");
    setLinks({});
    void Promise.all(
      roles.map(async ([role]) => {
        const r = await fetch(`/api/games/${id}/invitations`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${chooser}`,
          },
          body: JSON.stringify({ role }),
        });
        const result = await r.json().catch(() => null);
        if (!r.ok || !result?.token)
          throw new Error(result?.error || "This invitation is unavailable.");
        return [role, result.token];
      }),
    )
      .then((x) => setLinks(Object.fromEntries(x)))
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "This invitation is unavailable.",
        ),
      );
  }, [id, search, retry]);
  async function claim(role: Role, token?: string) {
    const claimant =
      localStorage.getItem("curlcast-device") || crypto.randomUUID();
    localStorage.setItem("curlcast-device", claimant);
    const t = token || links[role];
    const r = await fetch(`/api/games/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: t, claimant }),
    });
    if (!r.ok) {
      setError((await r.json()).error);
      return;
    }
    const result = await r.json();
    preserveAndStoreParticipantAccess(localStorage, id, result.sessionToken);
    router.push(role === "scorer" ? `/score/${id}` : `/camera/${id}/${role}`);
  }
  const direct = search.get("token");
  if (direct)
    return (
      <main className="mx-auto max-w-md p-5">
        <div className="panel">
          <h1 className="text-3xl font-black">Join CurlCast</h1>
          <p className="my-4">
            This secure link assigns this phone its game role.
          </p>
          <button
            className="btn w-full"
            onClick={async () => {
              try {
                const p = JSON.parse(
                  atob(
                    direct.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
                  ),
                );
                await claim(p.role, direct);
              } catch {
                setError("This link is invalid.");
              }
            }}
          >
            Claim this role
          </button>
          {error && (
            <p role="alert" className="mt-3 text-amber-300">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-3xl font-black">Choose your phone’s job</h1>
      <p className="mb-5 text-slate-300">{game?.config.eventName}</p>
      <div className="grid gap-3">
        {roles.map(([role, label, note]) => (
          <button
            key={role}
            disabled={!links[role] || !!game?.claimedRoles[role]}
            onClick={() => claim(role)}
            className="panel text-left disabled:opacity-40"
          >
            <strong className="text-lg">{label}</strong>
            <span className="block text-slate-400">
              {game?.claimedRoles[role] ? "Already claimed" : note}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <div className="mt-3">
          <p role="alert" className="text-amber-300">
            {error}
          </p>
          {search.get("chooser") && (
            <button
              className="btn-secondary mt-3 w-full"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry invitation
            </button>
          )}
        </div>
      )}
    </main>
  );
}
