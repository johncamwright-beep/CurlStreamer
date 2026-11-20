"use client";
import { useState } from "react";
import { localDateTimeToUtc } from "@/lib/team-hierarchy";
const field =
  "mt-1 block min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 p-3";
export function ApprovePilotForm({
  account,
  onCancel,
  onApproved,
}: {
  account: { id: string; email: string; name?: string };
  onCancel: () => void;
  onApproved: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="grid w-full gap-3 border-t border-slate-600 pt-4 sm:grid-cols-2"
      aria-label={`Approve ${account.email} for pilot`}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          const expires = localDateTimeToUtc(
            String(f.get("expires")),
            "23:59",
            "America/Toronto",
          );
          if (!expires) throw Error("Choose a valid expiry date.");
          const r = await fetch("/api/admin/pilots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "approve",
              userId: account.id,
              name: f.get("name"),
              phone: f.get("phone"),
              team: f.get("team"),
              expiresAt: expires,
              coachSeats: Number(f.get("seats")),
            }),
          });
          const b = await r.json();
          if (b.saved) {
            onApproved(
              b.emailStatus === "accepted"
                ? "Pilot approved. Approval email accepted by the email provider."
                : "Pilot approved. Email delivery could not be confirmed; resend from Pilot teams.",
            );
            return;
          }
          if (!r.ok) throw Error(b.error || "Approval failed.");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Approval failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="sm:col-span-2">
        Create a separate, blank team for {account.email}. Their current login
        and password stay the same.
      </p>
      <label>
        Administrator name
        <input
          name="name"
          className={field}
          defaultValue={account.name ?? ""}
          required
          maxLength={100}
        />
      </label>
      <label>
        Phone number
        <input
          name="phone"
          type="tel"
          className={field}
          required
          minLength={7}
          maxLength={40}
        />
      </label>
      <label>
        Team name
        <input name="team" className={field} required maxLength={100} />
      </label>
      <label>
        Pilot access through (Toronto)
        <input name="expires" type="date" className={field} required />
      </label>
      <label>
        Shot Tracker coaching seats
        <select name="seats" className={field} defaultValue="1">
          <option value="0">Broadcasting only</option>
          <option value="1">1 coach</option>
          <option value="2">2 coaches</option>
          <option value="3">3 coaches</option>
        </select>
      </label>
      <p className="sm:col-span-2">
        Broadcasting is included. The administrator receives the first coaching
        seat when enabled.
      </p>
      {error && (
        <p role="alert" className="text-red-300 sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button className="btn" disabled={busy}>
          {busy ? "Approving…" : "Approve pilot and email"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
