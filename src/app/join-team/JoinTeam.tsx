"use client";

import Link from "next/link";
import { useState } from "react";

export function JoinTeam({ token }: { token?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const destination = token
    ? `/join-team?token=${encodeURIComponent(token)}`
    : "/join-team";

  async function accept() {
    if (!token) {
      setMessage("This invitation link is missing its token.");
      return;
    }
    setBusy(true);
    setMessage("");
    setNeedsSignIn(false);
    try {
      const response = await fetch("/api/account/members/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (response.status === 401) {
        setNeedsSignIn(true);
        setMessage(
          "Sign in or create an account before accepting this invitation.",
        );
      } else if (!response.ok)
        setMessage(body.error || "This invitation could not be accepted.");
      else
        setMessage(
          "You have joined the team. You can now open your dashboard.",
        );
    } catch {
      setMessage("This invitation could not be accepted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-5">
      <section className="panel grid w-full gap-4">
        <h1 className="text-3xl font-black">Join a team</h1>
        <p className="text-slate-300">
          You have been invited to join a Curl Streamer team.
        </p>
        {!token && (
          <p role="alert" className="text-red-300">
            This invitation link is invalid or incomplete.
          </p>
        )}
        <button
          type="button"
          className="btn w-full"
          disabled={!token || busy}
          onClick={() => void accept()}
        >
          {busy ? "Accepting…" : "Accept invitation"}
        </button>
        {message && (
          <p
            role={needsSignIn ? "alert" : "status"}
            className={needsSignIn ? "text-amber-300" : "text-slate-200"}
          >
            {message}
          </p>
        )}
        {token && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              className="btn text-center"
              href={`/login?next=${encodeURIComponent(destination)}`}
            >
              Sign in
            </Link>
            <Link
              className="btn-secondary text-center"
              href={`/signup?next=${encodeURIComponent(destination)}`}
            >
              Create account
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
