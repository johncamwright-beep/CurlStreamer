"use client";
import { useEffect, useState } from "react";
type Pilot = {
  id: string;
  administrator_name: string;
  email: string;
  phone: string;
  team_name: string;
  expires_at: string;
  activated_at: string | null;
  revoked_at: string | null;
  email_status: string;
  coach_seats: number;
  games: number;
  chartedGames: number;
  members: number;
  setup?: { step: number; complete: boolean; skipped?: number[] };
};
const field =
  "block min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 p-3";
export function PilotAdmin() {
  const [pilots, setPilots] = useState<Pilot[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    const r = await fetch("/api/admin/pilots", { cache: "no-store" });
    const b = await r.json();
    if (!r.ok) throw Error(b.error);
    setPilots(b.pilots);
  }
  useEffect(() => {
    void load().catch(() => setMessage("Pilot accounts are unavailable."));
  }, []);
  async function action(body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/pilots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      await load();
      if (!r.ok) throw Error(b.error);
      setMessage(
        b.emailStatus
          ? b.emailStatus === "accepted"
            ? "Credentials accepted by the email provider."
            : "Pilot saved. Email delivery is uncertain or failed; check the recipient before resending."
          : "Pilot access updated.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save pilot.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-4" aria-label="Pilot teams">
      <h2 className="text-2xl font-bold">Pilot teams</h2>
      <p>
        Create a separate team workspace and email temporary credentials to its
        administrator. They must change their password before accessing the
        team.
      </p>
      <form
        className="panel grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void action({
            action: "create",
            name: f.get("name"),
            email: f.get("email"),
            phone: f.get("phone"),
            team: f.get("team"),
            expiresAt: new Date(
              String(f.get("expires")) + "T23:59:59",
            ).toISOString(),
            coachSeats: Number(f.get("seats")),
          });
        }}
      >
        <label>
          Administrator name
          <input className={field} name="name" required maxLength={100} />
        </label>
        <label>
          Email
          <input className={field} name="email" type="email" required />
        </label>
        <label>
          Phone number
          <input
            className={field}
            name="phone"
            type="tel"
            required
            minLength={7}
            maxLength={40}
          />
        </label>
        <label>
          Team name
          <input className={field} name="team" required maxLength={100} />
        </label>
        <label>
          Pilot access through
          <input className={field} name="expires" type="date" required />
        </label>
        <label>
          Shot Tracker coaching seats
          <select className={field} name="seats" defaultValue="1">
            <option value="0">Broadcasting only</option>
            <option value="1">1 coach</option>
            <option value="2">2 coaches</option>
            <option value="3">3 coaches</option>
          </select>
        </label>
        <p className="sm:col-span-2">
          Broadcasting is included. Each team has up to three logins. The
          administrator receives the first coaching seat when enabled.
        </p>
        <button className="btn sm:col-span-2" disabled={busy}>
          {busy ? "Please wait…" : "Create pilot and email credentials"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      <button
        className="btn-secondary justify-self-start"
        disabled={busy}
        onClick={() =>
          void load().catch(() => setMessage("Could not refresh pilots."))
        }
      >
        Refresh pilots
      </button>
      {!pilots.length && <p>No pilot accounts created here yet.</p>}
      {pilots.map((p) => (
        <article className="panel grid gap-3" key={p.id}>
          <h3 className="text-xl font-bold">{p.team_name}</h3>
          <p>
            {p.administrator_name} ·{" "}
            <a
              href={`mailto:${p.email}`}
              className="inline-flex min-h-11 items-center break-all text-cyan-300"
            >
              {p.email}
            </a>{" "}
            · {p.phone}
          </p>
          <p>
            {p.revoked_at
              ? "Access revoked"
              : Date.parse(p.expires_at) <= Date.now()
                ? "Pilot expired"
                : p.activated_at
                  ? p.setup?.complete
                    ? "Walkthrough finished"
                    : "Setup underway"
                  : "Awaiting first password change"}{" "}
            · Access through {new Date(p.expires_at).toLocaleDateString()}
          </p>
          <p>
            Email: {p.email_status} · {p.coach_seats} coaching seats ·{" "}
            {p.members}/3 logins · {p.games} games · {p.chartedGames} charted
            games
          </p>
          {p.setup && (
            <p>
              Setup step {p.setup.step} of 6
              {p.setup.skipped?.length
                ? ` · ${p.setup.skipped.length} steps skipped`
                : ""}
            </p>
          )}
          {!p.activated_at && !p.revoked_at && (
            <button
              className="btn-secondary justify-self-start"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Send new temporary credentials? This replaces any previous temporary password.",
                  )
                )
                  void action({ action: "resend", id: p.id });
              }}
            >
              Send replacement credentials
            </button>
          )}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action({
                action: "access",
                id: p.id,
                expiresAt: new Date(
                  String(f.get("expires")) + "T23:59:59",
                ).toISOString(),
                revoke: false,
              });
            }}
          >
            <label>
              Access through
              <input
                className={field}
                type="date"
                name="expires"
                required
                defaultValue={p.expires_at.slice(0, 10)}
              />
            </label>
            <button className="btn-secondary" disabled={busy}>
              Update access
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !!p.revoked_at}
              onClick={() => {
                if (
                  confirm(
                    `Revoke pilot access for ${p.team_name}? Saved data will remain.`,
                  )
                )
                  void action({
                    action: "access",
                    id: p.id,
                    expiresAt: p.expires_at,
                    revoke: true,
                  });
              }}
            >
              Revoke access
            </button>
          </form>
        </article>
      ))}
    </section>
  );
}
