"use client";
import { useEffect, useState } from "react";
const field = "input mt-1 block w-full";
export function CurlCoachAdminPanel() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/platform/curlcoach", {
          cache: "no-store",
        });
        const body = (await response.json()) as { available?: boolean };
        setAvailable(response.ok && body.available === true);
      } catch {
        setAvailable(false);
      }
    })();
  }, []);
  async function save(body: Record<string, string | undefined>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/platform/curlcoach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Change unavailable.");
      setMessage("CurlCoach access updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Change unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const expiry = expiresAt
    ? { expiresAt: new Date(expiresAt).toISOString() }
    : {};
  return (
    <section
      className="panel mb-5 grid gap-4"
      aria-labelledby="curlcoach-admin-title"
    >
      <div>
        <h2 id="curlcoach-admin-title" className="text-xl font-bold">
          CurlCoach pilot access
        </h2>
        <p className="mt-1 text-slate-300">
          Access is explicit and audited. These controls never reveal a
          coach&apos;s private notes.
        </p>
      </div>
      {available === null ? (
        <p className="text-slate-300">Checking CurlCoach availability…</p>
      ) : !available ? (
        <p className="text-slate-300">
          CurlCoach is unavailable because this deployment has not enabled it.
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-red-300">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-cyan-300">
              {message}
            </p>
          )}
          <form
            className="grid gap-3 rounded-xl border border-slate-700 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save({ action: "entitlement", organizationId, ...expiry });
            }}
          >
            <h3 className="font-bold">Organization entitlement</h3>
            <label>
              Organization ID
              <input
                className={field}
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                required
              />
            </label>
            <label>
              Expire at (leave blank for pilot access until changed)
              <input
                className={field}
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
            <button className="btn" disabled={busy}>
              Save entitlement
            </button>
          </form>
          <form
            className="grid gap-3 rounded-xl border border-slate-700 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save({ action: "grant", targetUserId, ...expiry });
            }}
          >
            <h3 className="font-bold">Coach access for an active member</h3>
            <label>
              Member user ID
              <input
                className={field}
                value={targetUserId}
                onChange={(event) => setTargetUserId(event.target.value)}
                required
              />
            </label>
            <button className="btn" disabled={busy}>
              Grant coach access
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !targetUserId}
              onClick={() => void save({ action: "revoke", targetUserId })}
            >
              Revoke coach access
            </button>
            <p className="text-sm text-slate-400">
              The database accepts only an active verified member of the acting
              administrator&apos;s organization. This does not create members or
              consume a new login seat.
            </p>
          </form>
        </>
      )}
    </section>
  );
}
