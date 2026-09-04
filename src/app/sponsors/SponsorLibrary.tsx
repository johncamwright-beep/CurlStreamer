"use client";
import { useCallback, useEffect, useState } from "react";
import type { LibrarySponsor } from "@/lib/types";

export function SponsorLibrary() {
  const [sponsors, setSponsors] = useState<LibrarySponsor[]>([]);
  const [role, setRole] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "failure">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/sponsors", { cache: "no-store" });
    if (!response.ok) return setState("failure");
    const body = await response.json();
    setSponsors(body.sponsors);
    setRole(body.role);
    setState("ready");
  }, []);
  useEffect(() => void load(), [load]);
  const editable = role === "owner" || role === "team_admin";

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMessage("Validating and uploading sponsors…");
    const form = new FormData();
    const metadata = [...files].map((file) => ({
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ""),
      altText: `Sponsor logo for ${file.name.replace(/\.[^.]+$/, "")}`,
    }));
    for (const file of files) form.append("file", file);
    form.set("metadata", JSON.stringify(metadata));
    const response = await fetch("/api/sponsors", {
      method: "POST",
      body: form,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(body?.error ?? "Upload failed. The library was not changed.");
      await load();
      return;
    }
    setSponsors(body.sponsors);
    setMessage(
      `${files.length} sponsor${files.length === 1 ? "" : "s"} uploaded.`,
    );
  }

  async function update(sponsor: LibrarySponsor, archived: boolean) {
    const name = archived
      ? sponsor.name
      : prompt("Sponsor display name", sponsor.name);
    if (!name) return;
    const altText = archived
      ? sponsor.altText
      : prompt("Accessible image description", sponsor.altText);
    if (!altText) return;
    const response = await fetch("/api/sponsors", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "update",
        id: sponsor.id,
        name,
        altText,
        archived,
      }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok) setSponsors(body.sponsors);
    else setMessage(body?.error ?? "Sponsor update failed.");
  }

  async function move(index: number, delta: number) {
    const active = sponsors.filter((item) => !item.archived);
    const target = index + delta;
    if (target < 0 || target >= active.length) return;
    [active[index], active[target]] = [active[target], active[index]];
    const response = await fetch("/api/sponsors", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reorder",
        ids: active.map((item) => item.id),
      }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok) setSponsors(body.sponsors);
  }

  async function replace(sponsor: LibrarySponsor, file?: File) {
    if (!file) return;
    setMessage(`Replacing ${sponsor.name}…`);
    const form = new FormData();
    form.set("id", sponsor.id);
    form.set("file", file);
    const response = await fetch("/api/sponsors", {
      method: "PUT",
      body: form,
    });
    const body = await response.json().catch(() => null);
    if (response.ok) {
      setSponsors(body.sponsors);
      setMessage(`${sponsor.name} replaced.`);
    } else setMessage(body?.error ?? "Replacement failed.");
  }

  if (state === "loading") return <p>Loading sponsor library…</p>;
  if (state === "failure")
    return (
      <p role="alert">
        The sponsor library is temporarily unavailable.{" "}
        <button className="btn-secondary" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  const active = sponsors.filter((item) => !item.archived);
  const archived = sponsors.filter((item) => item.archived);
  return (
    <div className="grid gap-6">
      {editable && (
        <label className="btn w-fit cursor-pointer">
          Upload sponsor images
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => void upload(event.target.files)}
          />
        </label>
      )}
      {role === "scorer" && (
        <p className="text-slate-300">
          You have read-only access to your team’s sponsor library.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!active.length ? (
        <div className="panel">
          <h2 className="text-xl font-bold">No active sponsors</h2>
          <p className="text-slate-300">
            Games will continue to use their legacy sponsors until an
            organization sponsor is active.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((sponsor, index) => (
            <li className="panel" key={sponsor.id}>
              <div className="aspect-square rounded-xl bg-white p-4">
                <img
                  className="h-full w-full object-contain"
                  src={sponsor.imageUrl}
                  alt={sponsor.altText}
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                    setMessage(
                      "A sponsor preview expired. Refresh to renew it.",
                    );
                  }}
                />
              </div>
              <strong className="mt-3 block">{sponsor.name}</strong>
              {editable && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-secondary"
                    onClick={() => void update(sponsor, false)}
                  >
                    Rename
                  </button>
                  <label className="btn-secondary cursor-pointer">
                    Replace
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) =>
                        void replace(sponsor, event.target.files?.[0])
                      }
                    />
                  </label>
                  <button
                    className="btn-secondary"
                    disabled={index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    Move up
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={index === active.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    Move down
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => void update(sponsor, true)}
                  >
                    Archive
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <section>
          <h2 className="mb-3 text-2xl font-bold">Archive</h2>
          <ul className="grid gap-3">
            {archived.map((sponsor) => (
              <li
                className="panel flex min-h-11 items-center justify-between gap-3"
                key={sponsor.id}
              >
                <span>{sponsor.name}</span>
                {editable && (
                  <button
                    className="btn-secondary"
                    onClick={() => void update(sponsor, false)}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
