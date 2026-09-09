"use client";
import { useEffect, useRef, useState } from "react";
import { organizerAccessToken } from "@/lib/access-session";
import {
  studioTicketSchema,
  type CameraRole,
  type StudioTicket,
} from "@/lib/m2-studio-protocol";
import { programRoles } from "@/lib/providers/m3-program-browser";

export function M3Operator({ id }: { id: string }) {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const handoff = useRef<
    { until: number; sessions: Record<CameraRole, StudioTicket> } | undefined
  >(undefined);
  const headers = () => {
    const token = organizerAccessToken(localStorage, id);
    return {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  };
  useEffect(() => {
    let running = false;
    const timer = setInterval(() => {
      if (running || !handoff.current || Date.now() > handoff.current.until)
        return;
      running = true;
      const current = handoff.current;
      void Promise.all(
        programRoles.map((cameraRole) =>
          fetch(`/api/games/${id}/studio-m2`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
              action: "check",
              side: "receiver",
              cameraRole,
              sessionId: current.sessions[cameraRole].sessionId,
            }),
            signal: AbortSignal.timeout(8_000),
          }),
        ),
      )
        .then((responses) => {
          if (
            responses.some((response) => !response.ok) &&
            handoff.current === current
          ) {
            handoff.current = undefined;
            setMessage("PC registration ended. Prepare a new source.");
          }
        })
        .catch(() =>
          setMessage(
            "Could not keep the source registration alive. Check the server before continuing.",
          ),
        )
        .finally(() => {
          running = false;
        });
    }, 5_000);
    return () => clearInterval(timer);
  }, [id]);
  async function prepare() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setSource("");
    handoff.current = undefined;
    try {
      const response = await fetch(`/api/games/${id}/studio-m3`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "prepare" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw Error();
      const result = await response.json();
      const sourceUrl = new URL(result.sourceUrl);
      if (
        sourceUrl.origin !== location.origin ||
        sourceUrl.pathname !== `/studio-m3/${id}/program` ||
        !sourceUrl.hash.startsWith("#code=")
      )
        throw Error();
      const sessions = {
        "camera-home": studioTicketSchema.parse(result.sessions["camera-home"]),
        "camera-away": studioTicketSchema.parse(result.sessions["camera-away"]),
      };
      handoff.current = { until: Date.now() + 300_000, sessions };
      setSource(sourceUrl.toString());
      setMessage(
        "Source ready for five minutes. Keep this page open while adding it to OBS, then restart each camera on its device.",
      );
    } catch {
      setMessage(
        "Could not prepare the OBS source. Sign in as the game organizer and check the local server.",
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([source], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "curlstreamer-obs-source.txt";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="text-3xl font-bold">M3 · Local OBS program</h1>
      <p>
        This transfers reception of both cameras to the OBS program source.
        Preparing it replaces both M2 receiver registrations. Camera assignments
        are retained.
      </p>
      <button
        className="btn min-h-11"
        disabled={busy}
        onClick={() => void prepare()}
      >
        Prepare private OBS source
      </button>
      {message && (
        <p role="status" className="rounded-xl border border-slate-600 p-4">
          {message}
        </p>
      )}
      {source && (
        <section className="space-y-3" aria-label="Private source handoff">
          <label className="block" htmlFor="obs-source">
            One-use OBS Browser Source URL
          </label>
          <input
            id="obs-source"
            readOnly
            value={source}
            className="min-h-11 w-full rounded border border-slate-500 bg-slate-900 p-3"
          />
          <button className="btn-secondary min-h-11" onClick={download}>
            Download source file
          </button>
          <p>
            Add this URL to the dedicated OBS Browser Source at 1920 × 1080 and
            30 fps. Keep “Shutdown source when not visible” and “Refresh browser
            when scene becomes active” off. Use OBS Interact only if browser
            permissions need attention.
          </p>
          <p>
            The invitation is consumed by its first browser. Do not open it in
            another tab before OBS. Its replacement cookie permits only this
            game’s prepared receiver sessions.
          </p>
        </section>
      )}
      <p>
        Start each camera using its existing M2 camera page. OBS receives
        automatically. Score, layout, and sponsors continue to use the existing
        game controls.
      </p>
      <p>
        Long recording and endurance checks are deferred to final validation. No
        YouTube output is started here.
      </p>
      <a
        className="inline-flex min-h-11 items-center text-cyan-300 underline"
        href={`/games/${id}`}
      >
        Game controls
      </a>
    </main>
  );
}
