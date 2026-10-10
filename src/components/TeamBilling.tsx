"use client";

import { useEffect, useState } from "react";

type Billing = {
  mode: "test";
  available: boolean;
  canManage: boolean;
  plan: null | {
    name: string;
    amount: number;
    currency: string;
    interval: string;
  };
  subscription: null | {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  hasCustomer: boolean;
};

const managedSubscriptionStatuses = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

export function TeamBilling({ canManage }: { canManage: boolean }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [returned, setReturned] = useState<"returned" | "cancelled" | null>(
    null,
  );

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/account/billing", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBilling(data);
    } catch {
      setError("Subscription details could not be loaded. Please try again.");
    }
  }

  useEffect(() => {
    const result = new URL(window.location.href).searchParams.get("billing");
    if (result === "returned" || result === "cancelled") setReturned(result);
    void load();
  }, []);

  async function open(action: "checkout" | "portal") {
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/account/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.url !== "string") {
        throw new Error(data.error);
      }
      window.location.assign(data.url);
    } catch {
      setError("Subscription checkout could not be opened. Please try again.");
      setBusy(null);
    }
  }

  const mayManage = canManage && billing?.canManage === true;
  const hasManagedSubscription = billing?.subscription
    ? managedSubscriptionStatuses.has(billing.subscription.status)
    : false;
  const mayCheckout = mayManage && !hasManagedSubscription;
  const mayOpenPortal = mayManage && billing?.hasCustomer === true;

  return (
    <section className="grid gap-4" aria-label="Test subscriptions">
      <h3 className="text-lg font-bold">Test subscriptions</h3>
      {returned === "returned" && (
        <p role="status" className="text-slate-300">
          You returned from Stripe test checkout. Reload subscription status to
          see the current test record.
        </p>
      )}
      {returned === "cancelled" && (
        <p role="status" className="text-slate-300">
          Stripe test checkout was cancelled. No subscription status has been
          assumed.
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {!billing ? (
        <button className="btn-secondary min-h-11" type="button" onClick={load}>
          Reload subscription status
        </button>
      ) : !billing.available ? (
        <p role="status">
          Subscription checkout is being prepared. Your trial codes still work.
        </p>
      ) : (
        <>
          <p className="text-slate-300">
            Stripe test mode — no real payments. Test subscriptions do not
            change your team’s broadcast access.
          </p>
          {billing.plan && (
            <p>
              {billing.plan.name}:{" "}
              {formatAmount(billing.plan.amount, billing.plan.currency)}
              {billing.plan.interval ? ` / ${billing.plan.interval}` : ""}
            </p>
          )}
          {billing.subscription && (
            <div className="grid gap-1 text-slate-300">
              <p>Test subscription status: {billing.subscription.status}.</p>
              {billing.subscription.currentPeriodEnd && (
                <p>
                  Current period ends:{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                  }).format(new Date(billing.subscription.currentPeriodEnd))}
                  .
                </p>
              )}
              {billing.subscription.cancelAtPeriodEnd && (
                <p>This test subscription will cancel at the period end.</p>
              )}
            </div>
          )}
          {!mayManage && (
            <p className="text-slate-300">
              Ask a team owner or administrator to manage test subscriptions.
            </p>
          )}
          {mayCheckout && (
            <button
              className="btn min-h-11"
              type="button"
              disabled={busy !== null}
              onClick={() => void open("checkout")}
            >
              {busy === "checkout" ? "Opening checkout…" : "Open test checkout"}
            </button>
          )}
          {mayOpenPortal && (
            <button
              className="btn-secondary min-h-11"
              type="button"
              disabled={busy !== null}
              onClick={() => void open("portal")}
            >
              {busy === "portal"
                ? "Opening portal…"
                : "Manage test subscription"}
            </button>
          )}
        </>
      )}
      {billing && (
        <button className="btn-secondary min-h-11" type="button" onClick={load}>
          Reload subscription status
        </button>
      )}
    </section>
  );
}
