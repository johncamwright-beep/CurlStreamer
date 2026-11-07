"use client";
import { useEffect, useState } from "react";
type Season = {
  available: boolean;
  mode: "live" | "test";
  canManage: boolean;
  purchase?: {
    baseOwned: boolean;
    coachSeats: number;
    pending: boolean;
  } | null;
  access: {
    setupExpiresAt?: string;
    pilotExpiresAt?: string;
    paidExpiresAt?: string;
    pageEnabled: boolean;
    streamEnabled: boolean;
  };
};
export function SeasonAccess() {
  const [data, setData] = useState<Season | null>(null),
    [base, setBase] = useState(true),
    [coaches, setCoaches] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [returned, setReturned] = useState<string | null>(null);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/account/season", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error();
      const d = await r.json();
      setData(d);
      setBase(!d.purchase?.baseOwned);
      setCoaches((count) =>
        Math.min(count, Math.max(0, 2 - (d.purchase?.coachSeats ?? 0))),
      );
    } catch {
      setError("Season access could not be loaded. Please retry.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setReturned(new URLSearchParams(window.location.search).get("season"));
    void load();
  }, []);
  async function checkout(cancel = false) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/account/season", {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cancel ? { action: "cancel" } : { base, coaches }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.url) window.location.assign(d.url);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout unavailable");
    } finally {
      setBusy(false);
    }
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-CA", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Toronto",
    }).format(new Date(Date.parse(value) - 1));
  return (
    <section className="panel grid gap-3" aria-label="Season access">
      <h3 className="text-xl font-bold">Your season access</h3>
      <p>
        CurlStreamer: $89 CAD per season. Shot Tracker: $39 CAD per person, in
        addition to CurlStreamer. Access ends August 31. No automatic renewal.
      </p>
      {returned === "returned" && (
        <p role="status">
          You returned from Stripe. Access updates after payment is confirmed.
          Reload season access to check; returning here alone does not confirm
          payment.
        </p>
      )}
      {returned === "cancelled" && (
        <p role="status">
          Checkout was cancelled. You can resume it or cancel the pending
          checkout below to change your selection.
        </p>
      )}
      {loading && <p role="status">Loading season access…</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p role="status">
            {data.access.pageEnabled
              ? "Your public team page is eligible to be published."
              : "Your public team page is hidden until you purchase season access. Your team information is saved."}
          </p>
          {data.access.setupExpiresAt && !data.access.paidExpiresAt && (
            <p>
              Seven-day setup trial ends {date(data.access.setupExpiresAt)}{" "}
              (Toronto time). The setup trial includes team management and a
              public page, but does not include streaming or Shot Tracker.
            </p>
          )}
          {data.access.paidExpiresAt && (
            <p>
              Paid season access ends {date(data.access.paidExpiresAt)} (Toronto
              time).
            </p>
          )}
          {data.access.pilotExpiresAt &&
            Date.parse(data.access.pilotExpiresAt) > Date.now() && (
              <p>
                Your separately granted pilot access remains active through{" "}
                {date(data.access.pilotExpiresAt)}.
              </p>
            )}
          <p>
            {data.access.streamEnabled
              ? "Streaming access is enabled."
              : "Purchase CurlStreamer season access to stream."}{" "}
            Purchased Shot Tracker licences must be assigned under Team access
            before coaching becomes available.
          </p>
          {!data.available ? (
            <p>Season checkout is being prepared.</p>
          ) : data.canManage ? (
            <>
              {data.mode === "test" && (
                <p>
                  Stripe test mode: no real payment and no production access is
                  granted.
                </p>
              )}
              {data.purchase?.baseOwned && (
                <p>
                  Your {data.mode === "test" ? "test " : ""}season pass is
                  purchased. Shot Tracker licences purchased:{" "}
                  {data.purchase.coachSeats} of 2.
                </p>
              )}
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={base}
                  disabled={
                    busy || loading || Boolean(data.purchase?.baseOwned)
                  }
                  onChange={(e) => setBase(e.target.checked)}
                />
                CurlStreamer season pass — $89 CAD
              </label>
              <label>
                Shot Tracker licences to add
                <select
                  className="input min-h-11"
                  value={coaches}
                  disabled={busy}
                  onChange={(e) => setCoaches(Number(e.target.value))}
                >
                  <option value={0}>None</option>
                  <option
                    value={1}
                    disabled={(data.purchase?.coachSeats ?? 0) >= 2}
                  >
                    1 licence — $39 CAD
                  </option>
                  <option
                    value={2}
                    disabled={(data.purchase?.coachSeats ?? 0) >= 1}
                  >
                    2 licences — $78 CAD
                  </option>
                </select>
              </label>
              <p>
                Total: ${Number(base) * 89 + coaches * 39} CAD. All purchases
                expire at this season’s August 31 cutoff.
              </p>
              <button
                className="btn min-h-11"
                disabled={
                  busy ||
                  loading ||
                  (!base && !coaches) ||
                  (!base && !data.purchase?.baseOwned)
                }
                onClick={() => void checkout()}
              >
                {busy
                  ? "Opening…"
                  : data.mode === "test"
                    ? "Open test season checkout"
                    : "Continue to secure checkout"}
              </button>
              <button
                className="btn-secondary min-h-11"
                disabled={busy || loading || data.purchase?.pending === false}
                onClick={() => void checkout(true)}
              >
                Cancel pending checkout
              </button>
            </>
          ) : (
            <p>Ask your team owner or administrator to purchase access.</p>
          )}
        </>
      )}
      <button
        className="btn-secondary min-h-11"
        disabled={busy || loading}
        onClick={() => void load()}
      >
        Reload season access
      </button>
    </section>
  );
}
