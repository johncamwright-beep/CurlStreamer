"use client";
import { useEffect, useState } from "react";

type Profile = {
  organization_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description?: string;
  linked?: boolean;
};
function profileUrl(slug: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? `https://${slug}.curlstreamer.app/`
    : undefined;
}
export function OpponentProfilePicker({
  opponentId,
  initialQuery = "",
  onLinked,
  canEdit = true,
}: {
  opponentId?: string;
  initialQuery?: string;
  canEdit?: boolean;
  onLinked?: (opponent: { id: string; display_name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [teams, setTeams] = useState<Profile[]>([]);
  const [linked, setLinked] = useState<Profile | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);
  useEffect(() => {
    if (!opponentId) {
      setLinked(null);
      return;
    }
    const controller = new AbortController();
    void fetch(
      `/api/opponent-profiles?opponentId=${encodeURIComponent(opponentId)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (response.ok) {
          const body = await response.json();
          if (!controller.signal.aborted)
            setLinked(body.profile?.linked ? body.profile : null);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [opponentId]);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setTeams([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setTeams([]);
    setError("");
    const timer = setTimeout(() => {
      void fetch(
        `/api/opponent-profiles?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal, cache: "no-store" },
      )
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw Error(body.error);
          if (!controller.signal.aborted) setTeams(body.teams);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setError(
              error instanceof Error
                ? error.message
                : "Team search is unavailable.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);
  async function link(profile: Profile | null) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/opponent-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opponentId,
          profileId: profile?.organization_id ?? null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setLinked(profile ? { ...profile, linked: true } : null);
      setOpen(false);
      setMessage(
        profile
          ? "Opponent linked to this team profile."
          : "Profile link removed. Your opponent and games are unchanged.",
      );
      onLinked?.(body.opponent);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The profile could not be linked.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 grid gap-2">
      {linked && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {linked.slug && profileUrl(linked.slug) ? (
            <a
              className="inline-flex min-h-11 items-center gap-2 text-cyan-300 underline"
              href={profileUrl(linked.slug)}
              target="_blank"
              rel="noreferrer"
            >
              {linked.logo_url && (
                <img
                  alt=""
                  src={linked.logo_url}
                  className="h-9 w-9 object-contain"
                />
              )}{" "}
              Linked: {linked.name}
            </a>
          ) : (
            <span>Linked team profile is not currently public.</span>
          )}
          {canEdit && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void link(null)}
            >
              Unlink profile
            </button>
          )}
        </div>
      )}
      {canEdit && (
        <button
          type="button"
          className="min-h-11 text-left text-cyan-300 underline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open
            ? "Close team search"
            : linked
              ? "Change linked profile"
              : "Find a team on CurlStreamer"}
        </button>
      )}
      {open && (
        <section
          className="grid gap-3 rounded-xl border border-slate-600 p-3"
          aria-label="Find opponent profile"
        >
          <label>
            Search public team profiles
            <input
              className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
              type="search"
              maxLength={100}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="text-sm text-slate-300">
            Choose the correct public team profile. You can keep a manually
            entered opponent and link it later when they join.
          </p>
          {searching && query.trim().length >= 2 ? (
            <p role="status">Searching teams…</p>
          ) : query.trim().length >= 2 && !error && !teams.length ? (
            <p>No public teams found. Save the opponent by name for now.</p>
          ) : null}
          <ul className="grid gap-2">
            {teams.map((team) => (
              <li
                key={team.organization_id}
                className="rounded-lg bg-slate-800 p-3"
              >
                <div className="flex items-center gap-2">
                  {team.logo_url && (
                    <img
                      alt=""
                      src={team.logo_url}
                      className="h-10 w-10 object-contain"
                    />
                  )}
                  <strong>{team.name}</strong>
                </div>
                <a
                  href={profileUrl(team.slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center text-cyan-300 underline"
                >
                  {team.slug}.curlstreamer.app
                </a>
                {team.description && (
                  <p className="text-sm text-slate-300">{team.description}</p>
                )}
                <button
                  type="button"
                  className="btn mt-2"
                  disabled={busy}
                  onClick={() => void link(team)}
                >
                  {busy
                    ? "Linking…"
                    : opponentId
                      ? `Link profile: ${team.name}`
                      : `Use opponent: ${team.name}`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {message && (
        <p role="status" className="text-sm text-cyan-200">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
