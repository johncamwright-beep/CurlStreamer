"use client";
import { useEffect, useState } from "react";
import { SeasonAccess } from "./SeasonAccess";
import { TeamBilling } from "./TeamBilling";
type Trial = {
  status: "none" | "active" | "expired";
  expiresAt: string | null;
};
export function TeamTrial({ canManage }: { canManage: boolean }) {
  const [accessVersion, setAccessVersion] = useState(0);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  async function load() {
    setError("");
    try {
      const response = await fetch("/api/account/trial", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setTrial(data);
    } catch {
      setError("Trial details could not be loaded. Please try again.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="grid gap-4">
      <h2 className="text-xl font-bold">Trial & subscription</h2>
      <SeasonAccess key={accessVersion} />
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {!trial ? (
        <>
          <p>Loading trial details…</p>
          <button className="btn-secondary" onClick={load}>
            Retry
          </button>
        </>
      ) : (
        <>
          <p role="status">
            {trial.status === "active"
              ? "Your team’s pilot access is active."
              : trial.status === "expired"
                ? "Your team’s pilot access has ended."
                : "Your team has not redeemed a pilot code."}
          </p>
          {trial.expiresAt && (
            <p>
              Pilot access ends:{" "}
              {new Intl.DateTimeFormat("en-CA", {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: "America/Toronto",
              }).format(new Date(Date.parse(trial.expiresAt) - 1))}{" "}
              (Toronto time).
            </p>
          )}
          <p className="text-slate-300">
            A trial code activates access for your whole team. No card is
            required and redeeming a code does not authorize automatic charges.
          </p>
          <p className="text-slate-300">
            When pilot access ends, a season pass will be required to start
            another broadcast. Your account and game history remain saved. Your
            public page is hidden unless you have active season or pilot access.
          </p>
          {trial.status === "none" &&
            (canManage ? (
              <form
                className="grid gap-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const response = await fetch("/api/account/trial", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ code }),
                    });
                    const data = await response.json();
                    if (!response.ok) throw Error(data.error);
                    setTrial(data);
                    setCode("");
                    setAccessVersion((version) => version + 1);
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Code could not be redeemed.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Trial code
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 p-3"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                    maxLength={80}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <button className="btn" disabled={busy}>
                  {busy ? "Activating…" : "Activate team trial"}
                </button>
              </form>
            ) : (
              <p>
                Ask your team owner or administrator to enter your trial code.
              </p>
            ))}
          <TeamBilling canManage={canManage} />
        </>
      )}
    </div>
  );
}
