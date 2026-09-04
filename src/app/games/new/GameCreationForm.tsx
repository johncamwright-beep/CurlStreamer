"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GameCreationForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventName: form.get("eventName"),
        homeName: form.get("homeName"),
        awayName: form.get("awayName"),
        homeColor: form.get("homeColor"),
        awayColor: form.get("awayColor"),
        scheduledEnds: Number(form.get("scheduledEnds")),
        youtubeTitle: form.get("youtubeTitle"),
        youtubeVisibility: form.get("youtubeVisibility"),
      }),
    });
    if (response.ok) {
      const game = await response.json();
      localStorage.setItem(`curlcast-access-${game.id}`, game.organizerToken);
      router.push(`/games/${game.id}`);
      return;
    }
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    setError(result?.error ?? "Please check every field.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="panel grid gap-4 md:grid-cols-2">
      <h1 className="text-3xl font-black md:col-span-2">Create a game</h1>
      <label>
        Event
        <input
          required
          name="eventName"
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        YouTube title
        <input
          required
          name="youtubeTitle"
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Home team
        <input
          required
          name="homeName"
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Away team
        <input
          required
          name="awayName"
          className="mt-1 w-full rounded-lg bg-slate-800 p-3"
        />
      </label>
      <label>
        Home colour
        <input
          name="homeColor"
          type="color"
          defaultValue="#ef4444"
          className="mt-1 min-h-11 w-full bg-slate-800"
        />
      </label>
      <label>
        Away colour
        <input
          name="awayColor"
          type="color"
          defaultValue="#2563eb"
          className="mt-1 min-h-11 w-full bg-slate-800"
        />
      </label>
      <label>
        Scheduled ends
        <select
          name="scheduledEnds"
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option>8</option>
          <option>10</option>
        </select>
      </label>
      <label>
        Visibility
        <select
          name="youtubeVisibility"
          defaultValue="unlisted"
          className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
        >
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
      </label>
      <button disabled={busy} className="btn md:col-span-2">
        {busy ? "Creating…" : "Create game"}
      </button>
      {error && (
        <p role="alert" className="text-red-300 md:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
