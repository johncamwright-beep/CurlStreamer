"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      eventName: fd.get("eventName"),
      homeName: fd.get("homeName"),
      awayName: fd.get("awayName"),
      homeColor: fd.get("homeColor"),
      awayColor: fd.get("awayColor"),
      scheduledEnds: Number(fd.get("scheduledEnds")),
      youtubeTitle: fd.get("youtubeTitle"),
      youtubeVisibility: fd.get("youtubeVisibility"),
    };
    const r = await fetch("/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const g = await r.json();
      localStorage.setItem(`curlcast-access-${g.id}`, g.organizerToken);
      router.push(`/games/${g.id}`);
    } else {
      setError("Please check every field.");
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-5 md:py-12">
      <header className="mb-8">
        <p className="font-bold tracking-widest text-cyan-300">
          CURLCAST · MOCK MODE
        </p>
        <h1 className="text-5xl font-black">
          Broadcast curling.
          <br />
          Just add three phones.
        </h1>
        <p className="mt-4 text-lg text-slate-300">
          Create a game, share one QR code, and put parents in control—no OBS or
          shared network.
        </p>
      </header>
      <form onSubmit={submit} className="panel grid gap-4 md:grid-cols-2">
        <h2 className="text-2xl font-bold md:col-span-2">Create a game</h2>
        <label>
          Event
          <input
            required
            name="eventName"
            defaultValue="Friday Night Curling"
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          />
        </label>
        <label>
          YouTube title
          <input
            required
            name="youtubeTitle"
            defaultValue="Friday Night Curling Live"
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          />
        </label>
        <label>
          Home team
          <input
            required
            name="homeName"
            defaultValue="Granite"
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          />
        </label>
        <label>
          Away team
          <input
            required
            name="awayName"
            defaultValue="Glaciers"
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
          />
        </label>
        <label>
          Home colour
          <input
            name="homeColor"
            type="color"
            defaultValue="#ef4444"
            className="mt-1 w-full bg-slate-800"
          />
        </label>
        <label>
          Away colour
          <input
            name="awayColor"
            type="color"
            defaultValue="#2563eb"
            className="mt-1 w-full bg-slate-800"
          />
        </label>
        <label>
          Scheduled ends
          <select
            name="scheduledEnds"
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
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
            className="mt-1 w-full rounded-lg bg-slate-800 p-3"
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
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
