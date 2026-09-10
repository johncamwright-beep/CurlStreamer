"use client";
import { useEffect, useState } from "react";
import {
  defaultTeamPageSettings,
  type TeamPageSettings,
} from "@/lib/team-page-settings";
export function TeamSettings({ name }: { name: string }) {
  const [settings, setSettings] = useState(defaultTeamPageSettings(name)),
    [logo, setLogo] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    try {
      const response = await fetch("/api/account/team");
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setSettings(body.settings);
      setLogo(body.logo);
      setCanEdit(body.canEdit);
      setReady(true);
      setMessage("");
    } catch {
      setMessage(
        "Team settings are temporarily unavailable. Please try again.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function change<K extends keyof TeamPageSettings>(
    key: K,
    value: TeamPageSettings[K],
  ) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setMessage("Team settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/account/team", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setLogo(body.logo);
      setMessage("Team logo saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-4" aria-label="Team settings">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Team settings</h2>
        <button
          type="button"
          className="btn"
          disabled={!ready || !canEdit || busy}
          onClick={save}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {!ready && (
        <button className="btn-secondary" onClick={load}>
          Reload team settings
        </button>
      )}
      <fieldset
        disabled={!ready || !canEdit || busy}
        className="grid gap-4 md:grid-cols-2"
      >
        <div className="panel grid content-start gap-3">
          <h3 className="font-bold">Team details</h3>
          <label>
            Team name
            <input
              className="input mt-1 w-full"
              value={settings.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </label>
          <label>
            About the team
            <textarea
              className="input mt-1 w-full"
              rows={3}
              maxLength={1000}
              value={settings.description}
              onChange={(e) => change("description", e.target.value)}
            />
          </label>
          {logo && (
            <img
              src={logo}
              alt="Team logo"
              className="h-20 w-20 object-contain"
            />
          )}
          <label>
            Upload team logo
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mt-2 block min-h-11 w-full"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
          <p className="text-sm text-slate-400">
            PNG, JPEG or WebP, up to 4 MB. This artwork can appear on your
            broadcasts and public team page.
          </p>
        </div>
        <div className="panel grid content-start gap-3">
          <h3 className="font-bold">Public team page</h3>
          <label>
            Team address
            <div className="flex items-center gap-1">
              <input
                className="input min-w-0 flex-1"
                value={settings.slug}
                onChange={(e) => change("slug", e.target.value)}
                aria-label="Team subdomain"
              />
              <span>.curlstreamer.app</span>
            </div>
          </label>
          <p className="text-sm text-slate-400">
            Publish your page to activate this address. Turn publication off to
            hide it again.
          </p>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={settings.published}
              onChange={(e) => change("published", e.target.checked)}
            />
            Publish team page
          </label>
          {(
            [
              ["results", "Results and YouTube replays"],
              ["upcoming", "Upcoming games"],
              ["news", "News and game summaries"],
              ["sponsors", "Sponsors"],
              ["socials", "Social profiles"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => change(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
          <a
            href={"https://" + settings.slug + ".curlstreamer.app"}
            target="_blank"
            rel="noreferrer"
            className="min-h-11 text-cyan-300 underline"
          >
            View saved public page
          </a>
        </div>
        <div className="panel grid gap-3 md:col-span-2">
          <h3 className="font-bold">Social media</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              Facebook Page link
              <input
                type="url"
                className="input mt-1 w-full"
                placeholder="https://www.facebook.com/yourteam"
                value={settings.facebook}
                onChange={(e) => change("facebook", e.target.value)}
              />
            </label>
            <label>
              Instagram profile link
              <input
                type="url"
                className="input mt-1 w-full"
                placeholder="https://www.instagram.com/yourteam"
                value={settings.instagram}
                onChange={(e) => change("instagram", e.target.value)}
              />
            </label>
          </div>
          <p className="text-sm text-slate-400">
            Profile links appear on your public page. Feed display and automatic
            posting require a connected social account.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-secondary" disabled>
              Connect Facebook — coming soon
            </button>
            <button type="button" className="btn-secondary" disabled>
              Connect Instagram — coming soon
            </button>
          </div>
          <p className="text-sm text-slate-400">
            We’re setting up Curl Streamer’s Meta integration. Once ready,
            you’ll sign in here and choose the Pages and profiles to connect.
          </p>
        </div>
      </fieldset>
    </section>
  );
}
