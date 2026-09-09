"use client";
import Link from "next/link";
import { useState } from "react";
import { AppNavigation } from "./AppNavigation";
import "./game-entry.css";

export function GameReadScreen({
  label,
  error,
  retry,
  light = false,
}: {
  label: string;
  error?: string;
  retry: () => Promise<void>;
  light?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <main className={`game-entry-state ${light ? "is-management" : ""}`}>
      <div className="game-entry-state-inner">
        <AppNavigation />
        <section className="game-entry-state-card" aria-busy={busy || !error}>
          <p className="game-entry-eyebrow">{label}</p>
          <h1>
            {error ? `${label} unavailable` : `Loading ${label.toLowerCase()}…`}
          </h1>
          <p role={error ? "alert" : "status"}>
            {error || "Checking this game's access and latest details."}
          </p>
          <p>
            {error
              ? "Retry checks the game again. It does not repeat scoring, camera or broadcast actions. If access was removed, ask the organizer for a current invitation."
              : "You can return to your games while the connection is checked."}
          </p>
          <div className="game-entry-actions">
            {error && (
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await retry();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Checking…" : "Try again"}
              </button>
            )}
            <Link className="btn-secondary" href="/dashboard">
              Back to games
            </Link>
            {error && (
              <Link className="btn-secondary" href="/login">
                Sign in
              </Link>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
