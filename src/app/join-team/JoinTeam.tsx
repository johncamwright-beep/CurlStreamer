"use client";

import Link from "next/link";
import { useState } from "react";
import { switchInvitationAccount } from "./actions";

export function JoinTeam({
  token,
  teamName,
  role,
  email,
  accepted = false,
  unavailable = false,
}: {
  token?: string;
  teamName?: string;
  role?: string;
  email?: string;
  accepted?: boolean;
  unavailable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [joined, setJoined] = useState(accepted);
  const [needsSignIn, setNeedsSignIn] = useState(!email);
  const destination = `/join-team?token=${encodeURIComponent(token ?? "")}`;

  async function accept() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/members/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) setNeedsSignIn(true);
      if (!response.ok)
        setMessage(
          body.error ||
            "The invitation could not be accepted. Please try again.",
        );
      else setJoined(true);
    } catch {
      setMessage("Could not reach CurlStreamer. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center p-5">
      <section className="panel grid w-full gap-5">
        <p className="text-sm font-semibold text-cyan-300">
          CurlStreamer · Team invitation
        </p>
        <h1 className="text-3xl font-black">
          {joined
            ? `Welcome to ${teamName}`
            : token
              ? `Join ${teamName}`
              : "Team invitation"}
        </h1>
        {!token ? (
          <>
            <p role="alert">
              {unavailable
                ? "We couldn’t load this invitation right now. Please refresh to try again."
                : "This invitation link is incomplete, expired, revoked, or already used. Ask the team owner for a new link."}
            </p>
            <Link
              className="btn-secondary min-h-11 text-center"
              href="/dashboard"
            >
              Open dashboard
            </Link>
          </>
        ) : joined ? (
          <>
            <p role="status">
              You’ve joined the team. Your own login now gives you access to its
              existing account.
            </p>
            <Link className="btn min-h-11 text-center" href="/dashboard">
              Open team dashboard
            </Link>
          </>
        ) : (
          <>
            <p>
              You’re invited with{" "}
              <strong>
                {role === "team_admin"
                  ? "full access to manage team settings and access"
                  : "game operations access to run games and broadcasts"}
              </strong>
              .
            </p>
            {needsSignIn ? (
              <>
                <ol className="list-decimal space-y-2 pl-5 text-slate-300">
                  <li>
                    Create your own account using any email address you prefer,
                    or sign in if you already have one.
                  </li>
                  <li>
                    If you register with a password, confirm your email using
                    the confirmation email we send you.
                  </li>
                  <li>
                    Return here and select <strong>Join team</strong>. You’ll
                    join this existing team; you don’t need to create another
                    team.
                  </li>
                </ol>
                <Link
                  className="btn min-h-11 text-center"
                  href={`/signup?next=${encodeURIComponent(destination)}`}
                >
                  Create account to join
                </Link>
                <Link
                  className="btn-secondary min-h-11 text-center"
                  href={`/login?next=${encodeURIComponent(destination)}`}
                >
                  I already have an account — sign in
                </Link>
              </>
            ) : (
              <>
                <p className="break-words">
                  You’ll join as <strong>{email}</strong>.
                </p>
                <button
                  type="button"
                  className="btn min-h-11 w-full"
                  disabled={busy}
                  onClick={() => void accept()}
                >
                  {busy ? "Joining…" : "Join team"}
                </button>
                <form action={switchInvitationAccount}>
                  <input type="hidden" name="token" value={token} />
                  <button
                    className="btn-secondary min-h-11 w-full"
                    disabled={busy}
                  >
                    Use a different account
                  </button>
                </form>
              </>
            )}
            {message && (
              <p role="alert" className="text-amber-300">
                {message}
              </p>
            )}
            <p className="text-sm text-slate-400">
              This private link is for one person. The account you use must not
              already belong to another team.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
