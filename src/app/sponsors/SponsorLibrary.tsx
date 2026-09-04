"use client";
import { useCallback, useEffect, useState } from "react";
import type { LibrarySponsor } from "@/lib/types";
import {
  snapshotSponsorFiles,
  uploadSponsorFiles,
  type PendingSponsorFile,
} from "./sponsor-upload";

export function SponsorLibrary() {
  const [sponsors, setSponsors] = useState<LibrarySponsor[]>([]);
  const [role, setRole] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "failure">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState<PendingSponsorFile[]>([]);
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

  async function upload(pending: PendingSponsorFile[]) {
    if (!pending.length) return;
    setFailed([]);
    const outcomes = await uploadSponsorFiles(
      pending,
      undefined,
      (done, total, name) =>
        setMessage(`Uploaded ${done} of ${total}: ${name}`),
    );
    const failures = outcomes.filter((item) => !item.ok);
    setFailed(failures);
    setMessage(
      failures.length
        ? failures.map((item) => `${item.file.name}: ${item.error}`).join(" · ")
        : `${outcomes.length} sponsor${outcomes.length === 1 ? "" : "s"} uploaded.`,
    );
    await load();
  }

  async function update(
    sponsor: LibrarySponsor,
    archived: boolean,
    edit = false,
  ) {
    const name = edit
      ? prompt("Sponsor display name", sponsor.name)
      : sponsor.name;
    if (!name) return;
    const altText = edit
      ? prompt("Accessible image description", sponsor.altText)
      : sponsor.altText;
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
    const form = new FormData();
    form.set("id", sponsor.id);
    form.set("file", file);
    const response = await fetch("/api/sponsors", {
      method: "PUT",
      body: form,
    });
    const body = await response.json().catch(() => null);
    if (response.ok) setSponsors(body.sponsors);
    setMessage(
      response.ok
        ? `${sponsor.name} replaced.`
        : `${file.name}: ${body?.error ?? "Replacement failed."}`,
    );
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
  const disabled = sponsors.filter((item) => item.archived);
  const row = (sponsor: LibrarySponsor, index?: number) => (
    <li
      className="panel flex min-w-0 flex-wrap items-center gap-3 p-3"
      key={sponsor.id}
    >
      <div className="h-20 w-20 shrink-0 rounded-lg bg-white p-2">
        <img
          className="h-full w-full object-contain"
          src={sponsor.imageUrl}
          alt={sponsor.altText}
          onError={() => setMessage("A preview expired. Refresh to renew it.")}
        />
      </div>
      <strong className="min-w-0 flex-1 truncate">{sponsor.name}</strong>
      {editable && index !== undefined && (
        <div className="flex gap-1">
          <button
            className="btn-secondary min-h-11 min-w-11 p-2 focus-visible:ring"
            disabled={index === 0}
            aria-label={`Move ${sponsor.name} up`}
            onClick={() => void move(index, -1)}
          >
            ↑
          </button>
          <button
            className="btn-secondary min-h-11 min-w-11 p-2 focus-visible:ring"
            disabled={index === active.length - 1}
            aria-label={`Move ${sponsor.name} down`}
            onClick={() => void move(index, 1)}
          >
            ↓
          </button>
        </div>
      )}
      {editable && (
        <button
          className="btn-secondary min-h-11 focus-visible:ring"
          aria-label={`${sponsor.archived ? "Enable" : "Disable"} ${sponsor.name}`}
          onClick={() => void update(sponsor, !sponsor.archived)}
        >
          {sponsor.archived ? "Disabled" : "Active"}
        </button>
      )}
      {editable && !sponsor.archived && (
        <details className="relative">
          <summary
            className="btn-secondary min-h-11 cursor-pointer list-none focus-visible:ring"
            aria-label={`More options for ${sponsor.name}`}
          >
            •••
          </summary>
          <div className="mt-2 grid gap-2 sm:absolute sm:right-0 sm:z-10 sm:w-48 sm:rounded-lg sm:bg-slate-900 sm:p-2">
            <button
              className="btn-secondary"
              onClick={() => void update(sponsor, false, true)}
            >
              Edit details
            </button>
            <label className="btn-secondary cursor-pointer text-center">
              Replace image
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) =>
                  void replace(sponsor, event.target.files?.[0])
                }
              />
            </label>
          </div>
        </details>
      )}
    </li>
  );
  return (
    <div className="grid gap-5 overflow-hidden">
      {editable && (
        <label className="btn w-fit cursor-pointer">
          Upload sponsor images
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => {
              const pending = snapshotSponsorFiles(event.target.files ?? []);
              event.target.value = "";
              void upload(pending);
            }}
          />
        </label>
      )}
      {role === "scorer" && (
        <p>You have read-only access to your team’s sponsor library.</p>
      )}
      {message && <p role={failed.length ? "alert" : "status"}>{message}</p>}
      {failed.length > 0 && (
        <button
          className="btn-secondary w-fit"
          onClick={() => void upload(failed)}
        >
          Retry failed files
        </button>
      )}
      {!active.length ? (
        <div className="panel">
          <h2 className="font-bold">No active sponsors</h2>
          <p>
            Games will use legacy sponsors until an organization sponsor is
            active.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {active.map((sponsor, index) => row(sponsor, index))}
        </ul>
      )}
      {disabled.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-xl font-bold focus-visible:ring">
            Disabled sponsors ({disabled.length})
          </summary>
          <ul className="grid gap-2">
            {disabled.map((sponsor) => row(sponsor))}
          </ul>
        </details>
      )}
    </div>
  );
}
