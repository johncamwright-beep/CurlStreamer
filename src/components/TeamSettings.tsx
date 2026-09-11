"use client";
import { useEffect, useState } from "react";
import { teamThemeStyle } from "@/lib/team-page-theme";
import { optimizeUploadImage } from "@/lib/optimize-upload-image";
import {
  defaultTeamPageSettings,
  throwingPositions,
  teamPageSettingsSchema,
  type TeamPageSettings,
} from "@/lib/team-page-settings";
export function TeamSettings({
  name,
  section = "team",
  onSaved,
}: {
  name: string;
  section?: "team" | "public" | "social" | "photos";
  onSaved?: () => void;
}) {
  const [settings, setSettings] = useState(defaultTeamPageSettings(name)),
    [savedSettings, setSavedSettings] = useState<TeamPageSettings | null>(null),
    [logo, setLogo] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirmPublish, setConfirmPublish] = useState(false);
  async function load() {
    try {
      const response = await fetch("/api/account/team", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setSettings(body.settings);
      setSavedSettings(body.settings);
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
  async function save(publish = false) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/team", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(publish ? { "X-Team-Publish": "confirm" } : {}),
        },
        body: JSON.stringify(
          publish ? { ...settings, published: true } : settings,
        ),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      const saved = teamPageSettingsSchema.parse(
        body.settings ??
          (publish ? { ...settings, published: true } : settings),
      );
      setSettings(saved);
      setSavedSettings(saved);
      setConfirmPublish(false);
      setMessage(
        publish
          ? "Your team page is published. Its address is now permanent."
          : "Team settings saved.",
      );
      if (!publish) onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(
    file: File | undefined,
    kind: "logo" | "photo" | "gallery" = "logo",
  ) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append(
        "file",
        await optimizeUploadImage(file, {
          maxSide: kind === "logo" ? 800 : 1600,
          aspectRatio: kind === "logo" ? undefined : 16 / 9,
        }),
      );
      form.append("kind", kind);
      const response = await fetch("/api/account/team", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      if (kind === "logo") setLogo(body.logo);
      else if (kind === "gallery") change("gallery", body.gallery);
      else change("photo", body.photo);
      setMessage(
        kind === "logo"
          ? "Team logo saved."
          : kind === "gallery"
            ? "Event photo saved."
            : "Team photo saved.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-4" aria-label="Team settings">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          {section === "team"
            ? "Team info"
            : section === "public"
              ? "Public team page"
              : section === "photos"
                ? "Event photos"
                : "Social media"}
        </h2>
        <button
          type="button"
          className="btn"
          disabled={!ready || !canEdit || busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : onSaved ? "Save and continue" : "Save changes"}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {!ready && (
        <button className="btn-secondary" onClick={load}>
          Reload team settings
        </button>
      )}
      <fieldset disabled={!ready || !canEdit || busy} className="grid gap-4">
        <div hidden={section !== "team"} className="account-settings-group">
          <label>
            Team name
            <input
              className="input mt-1 w-full"
              value={settings.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </label>
          <label>
            Team tagline
            <input
              className="input mt-1 w-full"
              maxLength={160}
              value={settings.tagline}
              onChange={(e) => change("tagline", e.target.value)}
              placeholder="A short line beneath your team name"
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
          <fieldset className="grid gap-3 rounded-lg border border-slate-700 p-3">
            <legend className="px-2 font-bold">Players</legend>
            <p className="text-sm text-slate-400">
              List players by throwing order, then choose who skips. The skip
              can throw in any position.
            </p>
            {throwingPositions.map((position) => (
              <label key={position} className="capitalize">
                {position}
                <input
                  className="input mt-1 w-full"
                  maxLength={100}
                  value={settings.roster[position]}
                  onChange={(e) =>
                    change("roster", {
                      ...settings.roster,
                      [position]: e.target.value,
                    })
                  }
                />
              </label>
            ))}
            <label>
              Skip throws
              <select
                className="input mt-1 w-full"
                value={settings.roster.skip}
                onChange={(e) =>
                  change("roster", {
                    ...settings.roster,
                    skip: e.target.value as typeof settings.roster.skip,
                  })
                }
              >
                {throwingPositions.map((position) => (
                  <option key={position} value={position}>
                    {position[0].toUpperCase() + position.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
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
            PNG, JPEG or WebP, up to 20 MB. Resized to JPEG under 300 KB;
            transparent areas become white. This artwork can appear on your
            broadcasts and public team page.
          </p>
          {settings.photo && (
            <img
              src={settings.photo}
              alt="Team photo"
              className="aspect-video w-full object-cover object-center"
            />
          )}
          <label>
            Upload team photo
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mt-2 block min-h-11 w-full"
              onChange={(e) => void upload(e.target.files?.[0], "photo")}
            />
          </label>
          <p className="text-sm text-slate-400">
            PNG, JPEG or WebP, up to 20 MB. Resized to JPEG under 300 KB;
            transparent areas become white. Team photos use a centered
            widescreen crop on your published team page.
          </p>
        </div>
        <div hidden={section !== "public"} className="account-settings-group">
          <fieldset className="grid gap-3 rounded-lg border border-slate-700 p-3">
            <legend className="px-2 font-bold">Page colors</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["background", "Page background"],
                  ["panel", "Panel background"],
                  ["accent", "Accent color"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="grid gap-2">
                  {label}
                  <input
                    type="color"
                    aria-label={label}
                    className="h-11 w-full cursor-pointer rounded"
                    value={settings.theme[key]}
                    onChange={(e) =>
                      change("theme", {
                        ...settings.theme,
                        [key]: e.target.value,
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div
              className="public-team-page rounded-lg p-4"
              style={teamThemeStyle(settings.theme)}
              aria-label="Page color preview"
            >
              <strong>{settings.name}</strong>
              <p>{settings.tagline || "Your team tagline"}</p>
              <div className="panel mt-3">
                <strong>Team news</strong>
                <p>Your page text stays readable against the chosen colors.</p>
                <span
                  className="mt-2 inline-block rounded px-3 py-2"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-text)",
                  }}
                >
                  Team colors
                </span>
              </div>
            </div>
          </fieldset>
          <label>
            Team address
            <div className="flex items-center gap-1">
              <input
                className="input min-w-0 flex-1"
                value={settings.slug}
                disabled={Boolean(savedSettings?.published)}
                onChange={(e) => change("slug", e.target.value)}
                aria-label="Team subdomain"
              />
              <span>.curlstreamer.app</span>
            </div>
          </label>
          {savedSettings?.published ? (
            <p role="status">
              Published. This team’s subdomain is permanent. You can continue
              editing the page content.
            </p>
          ) : (
            <div className="grid gap-3 rounded-lg border border-amber-500/50 p-3">
              <p>
                Each team can publish one subdomain. Once published, this
                address cannot be changed or published again under another
                address.
              </p>
              {!confirmPublish ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setConfirmPublish(true)}
                >
                  Publish team page
                </button>
              ) : (
                <>
                  <p>
                    Publish <strong>{settings.slug}.curlstreamer.app</strong>{" "}
                    permanently? This also saves your current page settings.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void save(true)}
                    >
                      Confirm permanent address
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setConfirmPublish(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {(
            [
              ["results", "Results and YouTube replays"],
              ["accomplishments", "Event accomplishments and medals"],
              ["photos", "Event photo carousel"],
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
          {savedSettings?.published ? (
            <a
              href={"https://" + savedSettings.slug + ".curlstreamer.app"}
              className="flex min-h-11 items-center text-cyan-300 underline"
            >
              Visit {savedSettings.slug}.curlstreamer.app
            </a>
          ) : (
            <p className="text-sm text-slate-400">
              Publish your team page to activate its permanent address.
            </p>
          )}
        </div>
        <div hidden={section !== "social"} className="account-settings-group">
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
        <div hidden={section !== "photos"} className="account-settings-group">
          <p>
            Add up to 50 event photos. Images are resized and saved as JPEGs
            under 300 KB before upload.
          </p>
          <label>
            Add event photo
            <input
              className="mt-2 block min-h-11 w-full"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={settings.gallery.length >= 50}
              onChange={(e) => void upload(e.target.files?.[0], "gallery")}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            {settings.gallery.map((item) => (
              <div
                key={item.id}
                className="grid gap-2 rounded-lg border border-slate-700 p-3"
              >
                <img
                  src={item.url}
                  alt={item.caption || "Event photo"}
                  className="h-36 w-full object-contain"
                />
                <label>
                  Photo caption
                  <input
                    className="input mt-1 w-full"
                    maxLength={200}
                    value={item.caption}
                    onChange={(e) =>
                      change(
                        "gallery",
                        settings.gallery.map((photo) =>
                          photo.id === item.id
                            ? { ...photo, caption: e.target.value }
                            : photo,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    change(
                      "gallery",
                      settings.gallery.filter((photo) => photo.id !== item.id),
                    )
                  }
                >
                  Remove from carousel
                </button>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-400">
            Save changes after editing captions or removing photos from the
            carousel.
          </p>
        </div>
      </fieldset>
    </section>
  );
}
