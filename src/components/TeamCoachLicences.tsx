"use client";
import { useEffect, useState } from "react";
type Details = {
  available: boolean;
  enabled: boolean;
  seats: number;
  canManage: boolean;
  members: { id: string; email: string; role: string; assigned: boolean }[];
};
export function TeamCoachLicences() {
  const [details, setDetails] = useState<Details | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load(ids?: string[]) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        "/api/account/curlcoach",
        ids
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ membershipIds: ids }),
            }
          : { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok)
        throw Error(body.error || "Coaching licences are unavailable.");
      setDetails(body);
      setSelected(
        (body.members || [])
          .filter((m: { assigned: boolean }) => m.assigned)
          .map((m: { id: string }) => m.id),
      );
      if (ids) {
        setMessage(
          "Coaching assignments saved. Assigned members will see CurlCoach when they next open the menu.",
        );
        window.dispatchEvent(new Event("curlcoach-access-changed"));
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save assignments.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (details && !details.available) return null;
  return (
    <section className="panel grid gap-3" aria-label="CurlCoach licences">
      <h3 className="text-xl font-bold">CurlCoach licences</h3>
      <p>
        Assign the team&apos;s licensed seats to yourself or accepted team
        members. Transferring access does not transfer anyone&apos;s private
        notes.
      </p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!details ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "Loading licences…" : "Reload licences"}
        </button>
      ) : (
        <>
          <p>
            {details.enabled
              ? `${selected.length} of ${details.seats} licensed coaching seats selected`
              : "No active CurlCoach licence. A subscription or pilot entitlement is required."}
          </p>
          {!details.canManage && (
            <p>The team owner manages these assignments.</p>
          )}
          <fieldset
            disabled={busy || !details.canManage}
            className="grid gap-2"
          >
            <legend className="sr-only">Assigned coaches</legend>
            {details.members.map((member) => (
              <label
                key={member.id}
                className="flex min-h-11 items-center gap-3"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(member.id)}
                  disabled={
                    !selected.includes(member.id) &&
                    (!details.enabled || selected.length >= details.seats)
                  }
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, member.id]
                        : current.filter((id) => id !== member.id),
                    )
                  }
                />
                <span>
                  {member.email}
                  {member.role === "owner" ? " (owner)" : ""}
                </span>
              </label>
            ))}
            {details.canManage && (
              <button
                type="button"
                className="btn"
                onClick={() => void load(selected)}
                disabled={!details.enabled && selected.length > 0}
              >
                {busy ? "Saving…" : "Save coaching assignments"}
              </button>
            )}
          </fieldset>
          <p className="text-sm text-slate-400">
            To transfer a seat, uncheck its current coach and select the new
            coach. Invite a teammate above and have them accept before assigning
            access. Extra seats require additional licences.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            Reload licences
          </button>
        </>
      )}
    </section>
  );
}
