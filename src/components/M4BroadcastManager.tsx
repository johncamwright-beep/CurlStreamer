"use client";

import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { organizerAccessToken } from "@/lib/access-session";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";

const sessionSchema = z.object({
  desiredState: z.enum(["live", "stopped"]),
  status: z.enum([
    "idle",
    "preparing",
    "prepared",
    "stopping",
    "stopped",
    "failed",
  ]),
  lastErrorCode: z.string().optional(),
  watchUrl: youtubeWatchUrlSchema.optional(),
});
export type M4ManagerSession = z.infer<typeof sessionSchema>;

function statusText(session: M4ManagerSession | undefined) {
  if (!session) return "Checking the preparation session…";
  if (session.status === "prepared")
    return "Prepared. The unlisted broadcast and its stream exist. Live status is checked manually in YouTube.";
  if (session.status === "failed")
    return "The previous operation is uncertain. Do not prepare a replacement; retire the owned resources after checking the provider.";
  if (session.status === "stopped")
    return "Provider retirement is confirmed for this preparation cycle.";
  if (session.status === "stopping")
    return "Retirement is being verified. Keep this page open and wait for a confirmed result.";
  if (session.status === "preparing")
    return "Preparation is in progress. Wait for a result before taking another action.";
  return "No broadcast is prepared for this cycle.";
}

export function m4SessionResolvesUncertainty(session: M4ManagerSession) {
  return session.status === "prepared" || session.status === "stopped";
}

export function m4ManagerCanAct(
  session: M4ManagerSession | undefined,
  freshRead: boolean,
  uncertain: boolean,
) {
  return Boolean(session && freshRead && !uncertain);
}

export function m4ManagerFailureMessage(
  action: "prepare" | "stop",
  refused = false,
) {
  if (refused)
    return "Broadcast administrator access was refused. No resource action was completed.";
  return action === "prepare"
    ? "Preparation outcome is unknown. Do not retry or create a replacement; check the provider and refresh this page."
    : "Retirement outcome is unknown. Keep the resources quarantined, check the provider, then refresh this page.";
}

export function M4BroadcastManager({ id }: { id: string }) {
  const [session, setSession] = useState<M4ManagerSession>();
  const [authority, setAuthority] = useState<"checking" | "allowed" | "denied">(
    "checking",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [freshRead, setFreshRead] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const epoch = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const actionInFlight = useRef(false);
  const uncertainRef = useRef(uncertain);
  const refresh = useRef<(explicit?: boolean) => void>(() => {});
  uncertainRef.current = uncertain;
  const headers = () => {
    const token = organizerAccessToken(localStorage, id);
    return {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  };

  useEffect(() => {
    let current = true;
    async function read(explicit = false) {
      if (actionInFlight.current) return;
      const readEpoch = epoch.current;
      try {
        const response = await fetch(`/api/games/${id}/studio-m4`, {
          headers: headers(),
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (current && readEpoch === epoch.current) {
              setAuthority("denied");
              setFreshRead(false);
              setSession(undefined);
            }
            return;
          }
          throw Error("unavailable");
        }
        const value = sessionSchema.parse(await response.json());
        if (current && readEpoch === epoch.current && !actionInFlight.current) {
          setAuthority("allowed");
          setSession(value);
          setFreshRead(true);
          if (
            explicit &&
            uncertainRef.current &&
            m4SessionResolvesUncertainty(value)
          ) {
            setUncertain(false);
            setMessage(
              "Session state was verified. Controls are available for this confirmed state.",
            );
          } else if (!uncertainRef.current) setMessage("");
        }
      } catch {
        if (current && readEpoch === epoch.current) {
          setAuthority("checking");
          setFreshRead(false);
          setSession(undefined);
          setMessage(
            "The session status is unknown. No resource action was sent; refresh only after checking the local service.",
          );
        }
      }
    }
    refresh.current = read;
    void read();
    const timer = setInterval(() => void read(), 15_000);
    return () => {
      current = false;
      epoch.current++;
      request.current?.abort();
      clearInterval(timer);
    };
    // Polling is read-only and is bounded by the request timeout above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(action: "prepare" | "stop") {
    if (
      actionInFlight.current ||
      busy ||
      authority !== "allowed" ||
      !m4ManagerCanAct(session, freshRead, uncertain)
    )
      return;
    actionInFlight.current = true;
    setBusy(true);
    setMessage("");
    const attempt = ++epoch.current;
    const controller = new AbortController();
    request.current = controller;
    let refused = false;
    try {
      const response = await fetch(`/api/games/${id}/studio-m4`, {
        method: "POST",
        credentials: "same-origin",
        headers: headers(),
        body: JSON.stringify({ action }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15_000),
        ]),
      });
      if (attempt !== epoch.current) return;
      if (!response.ok) {
        refused = response.status === 401 || response.status === 403;
        if (refused) setAuthority("denied");
        throw Error("request failed");
      }
      setSession(sessionSchema.parse(await response.json()));
      setFreshRead(true);
    } catch {
      if (attempt === epoch.current) {
        if (!refused) setUncertain(true);
        setFreshRead(false);
        setSession(undefined);
        setMessage(m4ManagerFailureMessage(action, refused));
      }
    } finally {
      if (attempt === epoch.current) setBusy(false);
      actionInFlight.current = false;
    }
  }

  const canPrepare =
    session?.status === "idle" || session?.status === "stopped";
  const canAct = m4ManagerCanAct(session, freshRead, uncertain);
  return (
    <main className="mx-auto min-h-screen max-w-2xl p-5 md:py-12">
      <section className="panel grid gap-5">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-cyan-300">
            M4 controlled rehearsal
          </p>
          <h1 className="mt-2 text-3xl font-black">Broadcast manager</h1>
        </div>
        <p>
          Prepare one unlisted, manual-lifecycle broadcast and stream.
          Preparation never starts delivery or makes the broadcast live.
        </p>
        <p role="status" className="rounded-lg bg-slate-800 p-3">
          {message || statusText(session)}
          {session?.lastErrorCode && (
            <span className="block pt-2 text-sm">
              Status code: {session.lastErrorCode}
            </span>
          )}
        </p>
        {authority === "denied" && (
          <a
            href="/login"
            className="flex min-h-11 items-center text-cyan-300 underline"
          >
            Sign in as a broadcast administrator
          </a>
        )}
        {authority === "allowed" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              disabled={busy || !canAct || !canPrepare}
              onClick={() => void act("prepare")}
              className="min-h-11 rounded-lg bg-cyan-400 px-4 py-3 font-bold text-slate-950 disabled:opacity-50"
            >
              {busy ? "Working…" : "Prepare unlisted broadcast"}
            </button>
            <button
              type="button"
              disabled={busy || !canAct || session?.status === "stopped"}
              onClick={() => void act("stop")}
              className="min-h-11 rounded-lg border border-slate-500 px-4 py-3 font-bold disabled:opacity-50"
            >
              {busy ? "Working…" : "Retire broadcast and stream"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => refresh.current(true)}
              className="min-h-11 rounded-lg border border-slate-500 px-4 py-3 font-bold disabled:opacity-50"
            >
              Verify session
            </button>
          </div>
        )}
        {session?.watchUrl && (
          <a
            href={session.watchUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center text-cyan-300 underline"
          >
            Open safe watch URL
          </a>
        )}
        <p className="text-sm text-slate-300">
          Start and end the broadcast manually in YouTube. Use retirement after
          the rehearsal; a failed or uncertain result never creates a
          replacement.
        </p>
      </section>
    </main>
  );
}
