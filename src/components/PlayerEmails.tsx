"use client";
import { useEffect, useState } from "react";
type Player = {
  id: string;
  name: string;
  position: string;
  email: string;
  parentEmail: string;
};
export function PlayerEmails() {
  const [players, setPlayers] = useState<Player[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [coachEmails, setCoachEmails] = useState<[string, string]>(["", ""]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/account/player-contacts", {
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        if (!c.signal.aborted) {
          setPlayers(data.players);
          setCoachEmails(data.coachEmails ?? ["", ""]);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setMessage("Player emails could not be loaded. Refresh to retry.");
      });
    return () => c.abort();
  }, []);
  async function saveCoaches() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/account/player-contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "coaches",
          emails: coachEmails.map((email) => email.trim()),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setMessage("Additional coach emails saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
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
          parentEmail: (player.parentEmail ?? "").trim(),
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
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
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
          <label>
            Parent email for {p.name} (optional)
            <input
              type="email"
              className="input mt-1 w-full"
              value={p.parentEmail ?? ""}
              maxLength={254}
              autoComplete="off"
              disabled={busy}
              onChange={(e) =>
                setPlayers((old) =>
                  old.map((x) =>
                    x.id === p.id ? { ...x, parentEmail: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <button className="btn-secondary min-h-11" disabled={busy || !loaded}>
            Save email for {p.name}
          </button>
        </form>
      ))}
      <p className="text-sm text-slate-300">
        Parents receive the team report and only their own player’s individual
        report.
      </p>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void saveCoaches();
        }}
      >
        <h4 className="font-bold">Additional coach emails</h4>
        <p className="text-sm text-slate-300">
          These coaches receive a private copy of every team and individual
          report you email. They appear in the recipient review before sending.
        </p>
        {coachEmails.map((email, index) => (
          <label key={index}>
            Additional coach {index + 1} email (optional)
            <input
              type="email"
              className="input mt-1 w-full"
              value={email}
              maxLength={254}
              autoComplete="off"
              disabled={busy || !loaded}
              onChange={(e) =>
                setCoachEmails((old) =>
                  index === 0
                    ? [e.target.value, old[1]]
                    : [old[0], e.target.value],
                )
              }
            />
          </label>
        ))}
        <button
          className="btn-secondary min-h-11 justify-self-start"
          disabled={busy || !loaded}
        >
          Save coach emails
        </button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}
