"use client";
import { useEffect, useState } from "react";
type Player = { id: string; name: string; position: string; email: string };
export function PlayerEmails() {
  const [players, setPlayers] = useState<Player[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/account/player-contacts", {
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        if (!c.signal.aborted) setPlayers(data.players);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setMessage("Player emails could not be loaded. Refresh to retry.");
      });
    return () => c.abort();
  }, []);
  async function save(player: Player) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/account/player-contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: player.id,
          email: player.email.trim(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setMessage(`Email saved for ${player.name}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-6 grid gap-4" aria-label="Private player emails">
      <h3 className="text-xl font-bold">Player report emails</h3>
      <p className="text-sm text-slate-300">
        Optional and private. These addresses do not appear on your public team
        page or create accounts. Reports are emailed only when you choose to
        send them.
      </p>
      {!players.length && <p>Save your roster above to add player emails.</p>}
      {players.map((p) => (
        <form
          key={p.id}
          className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void save(p);
          }}
        >
          <label>
            {p.name} · {p.position}
            <input
              type="email"
              className="input mt-1 w-full"
              value={p.email}
              maxLength={254}
              autoComplete="off"
              placeholder="Email address (optional)"
              onChange={(e) =>
                setPlayers((old) =>
                  old.map((x) =>
                    x.id === p.id ? { ...x, email: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <button className="btn-secondary min-h-11" disabled={busy}>
            Save email for {p.name}
          </button>
        </form>
      ))}
      <p role="status">{message}</p>
    </section>
  );
}
