"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { organizerAccessToken } from "@/lib/access-session";

const approvalSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime({ offset: true }),
});
export function M4DesktopPairing({ id }: { id: string }) {
  const [authority, setAuthority] = useState<"checking" | "allowed" | "denied">(
    "checking",
  );
  const [challenge, setChallenge] = useState("");
  const [approval, setApproval] = useState<z.infer<typeof approvalSchema>>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const epoch = useRef(0);
  const submitting = useRef<AbortController | undefined>(undefined);
  const headers = () => {
    const token = organizerAccessToken(localStorage, id);
    return {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  };
  useEffect(() => {
    let current = true,
      checking = false;
    const controller = new AbortController();
    setAuthority("checking");
    setChallenge("");
    setApproval(undefined);
    setMessage("");
    setBusy(false);
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch(`/api/games/${id}/studio-m4`, {
          headers: headers(),
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8_000),
          ]),
        });
        if (!response.ok) throw Error();
        if (current) setAuthority("allowed");
      } catch {
        if (current) {
          epoch.current++;
          submitting.current?.abort();
          setAuthority("denied");
          setApproval(undefined);
          setChallenge("");
          setBusy(false);
          setMessage(
            "Sign in as this game’s administrator or open it with organizer access, then reload this page.",
          );
        }
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), 15_000);
    return () => {
      current = false;
      epoch.current++;
      controller.abort();
      submitting.current?.abort();
      clearInterval(timer);
    };
    // The game-specific effect also fences pending approvals when navigating games.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!approval) return;
    const timer = setTimeout(
      () => {
        setApproval(undefined);
        setChallenge("");
        setMessage(
          "Approval expired. Get a fresh pairing challenge from the desktop helper.",
        );
      },
      Math.max(0, Date.parse(approval.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [approval]);
  useEffect(() => {
    if (!challenge) return;
    const timer = setTimeout(() => {
      epoch.current++;
      submitting.current?.abort();
      setBusy(false);
      setChallenge("");
      setMessage("Get a fresh pairing challenge from the desktop helper.");
    }, 5 * 60_000);
    return () => clearTimeout(timer);
  }, [challenge]);
  async function pair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || authority !== "allowed" || !/^[a-f0-9]{64}$/.test(challenge))
      return;
    setBusy(true);
    setApproval(undefined);
    setMessage("");
    const attempt = ++epoch.current;
    const controller = new AbortController();
    submitting.current = controller;
    try {
      const response = await fetch(
        `/api/games/${id}/studio-m4/desktop-pairing`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: headers(),
          body: JSON.stringify({ challenge }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        },
      );
      if (attempt !== epoch.current) return;
      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          setAuthority("denied");
          setChallenge("");
        }
        throw Error();
      }
      const value = approvalSchema.parse(await response.json());
      if (attempt !== epoch.current) return;
      const lifetime = Date.parse(value.expiresAt) - Date.now();
      if (lifetime <= 0 || lifetime > 5 * 60_000 + 10_000) throw Error();
      setApproval(value);
      setChallenge("");
      setMessage("Approval created; enter the code in the desktop helper.");
    } catch {
      if (attempt === epoch.current)
        setMessage(
          "Could not approve this desktop. Check your access and get a fresh pairing challenge before retrying.",
        );
    } finally {
      if (attempt === epoch.current) setBusy(false);
    }
  }
  return (
    <main className="mx-auto min-h-screen max-w-2xl p-5 md:py-12">
      <section className="panel grid gap-5">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-cyan-300">
            Desktop pilot
          </p>
          <h1 className="mt-2 text-3xl font-black">Pair this desktop</h1>
        </div>
        <p>
          Approve the pairing challenge shown by your desktop helper. Pairing
          does not start a broadcast.
        </p>
        {authority === "checking" && (
          <p role="status">Checking administrator access…</p>
        )}
        {message && (
          <p role="status" className="rounded-lg bg-slate-800 p-3">
            {message}
          </p>
        )}
        {authority === "denied" && (
          <a
            href="/login"
            className="flex min-h-11 items-center text-cyan-300 underline"
          >
            Sign in
          </a>
        )}
        {authority === "allowed" && !approval && (
          <form onSubmit={pair} className="grid gap-4">
            <label className="grid gap-2">
              Pairing challenge
              <input
                name="challenge"
                value={challenge}
                onChange={(event) => {
                  setChallenge(event.target.value.trim());
                  setMessage("");
                }}
                required
                pattern="[a-f0-9]{64}"
                maxLength={64}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={busy}
                className="min-h-11 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 font-mono text-sm"
                aria-describedby="pairing-challenge-help"
              />
            </label>
            <p id="pairing-challenge-help" className="text-sm text-slate-300">
              Paste the 64-character challenge from the desktop helper.
            </p>
            <button
              type="submit"
              disabled={busy || !/^[a-f0-9]{64}$/.test(challenge)}
              className="min-h-11 rounded-lg bg-cyan-400 px-4 py-3 font-bold text-slate-950 disabled:opacity-50"
            >
              {busy ? "Approving…" : "Pair this desktop"}
            </button>
          </form>
        )}
        {authority === "allowed" && approval && (
          <div className="grid gap-3">
            <label className="grid gap-2">
              One-use approval code
              <input
                readOnly
                value={approval.code}
                autoComplete="off"
                spellCheck={false}
                className="min-h-11 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 font-mono text-sm"
                onFocus={(event) => event.target.select()}
              />
            </label>
            <p className="text-sm text-slate-300">
              Use this code within five minutes. It expires at{" "}
              {new Date(approval.expiresAt).toLocaleTimeString()}.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
