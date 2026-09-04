"use client";
import { useRef, useState } from "react";

type Item = {
  id: string;
  display_name: string;
  alt_text: string;
  imageUrl: string | null;
  archived_at: string | null;
  updated_at: string;
};

export function SponsorLibrary({
  initial,
  canManage,
}: {
  initial: Item[];
  canManage: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const active = items.filter((x) => !x.archived_at);
  const archived = items.filter((x) => x.archived_at);

  async function send(body: FormData | object, method = "PATCH") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/sponsors", {
        method,
        body: body instanceof FormData ? body : JSON.stringify(body),
        headers:
          body instanceof FormData
            ? undefined
            : { "content-type": "application/json" },
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "The change could not be saved.");
      setItems(result.sponsors);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const form = new FormData();
    [...list].forEach((file) => {
      const label =
        file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[_-]+/g, " ")
          .trim() || "Sponsor";
      form.append("files", file);
      form.append("displayNames", label);
      form.append("altTexts", `${label} logo`);
    });
    await send(form, "POST");
    if (files.current) files.current.value = "";
  }
  async function reorder(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= active.length) return;
    const ordered = [...active];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await send({
      action: "reorder",
      sponsorId: active[index].id,
      orderedIds: ordered.map((x) => x.id),
    });
  }
  return (
    <div className="space-y-8">
      {canManage && (
        <section className="panel" aria-labelledby="upload-sponsors">
          <h2 id="upload-sponsors" className="text-2xl font-bold">
            Add sponsor images
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            JPEG, PNG, or WebP, up to 12 MB each. You can edit each name and alt
            text after upload.
          </p>
          <label className="btn mt-4 inline-flex min-h-11 cursor-pointer items-center">
            Upload one or more images
            <input
              ref={files}
              className="sr-only"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => void upload(e.target.files)}
            />
          </label>
        </section>
      )}
      {error && (
        <p className="panel border-red-500 text-red-200" role="alert">
          {error}
        </p>
      )}
      <section aria-labelledby="active-sponsors">
        <h2 id="active-sponsors" className="text-2xl font-bold">
          Active sponsors
        </h2>
        {!active.length ? (
          <div className="panel mt-3">
            <h3 className="font-bold">No active sponsors yet</h3>
            <p className="mt-1 text-slate-300">
              {canManage
                ? "Upload sponsor logos to make them available to every game."
                : "A team administrator has not added any sponsors."}
            </p>
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((item, index) => (
              <SponsorCard
                key={item.id}
                item={item}
                canManage={canManage}
                disabled={busy}
                moveEarlier={() => reorder(index, -1)}
                moveLater={() => reorder(index, 1)}
                first={index === 0}
                last={index === active.length - 1}
                send={send}
              />
            ))}
          </div>
        )}
      </section>
      {archived.length > 0 && (
        <section aria-labelledby="archived-sponsors">
          <h2 id="archived-sponsors" className="text-2xl font-bold">
            Archived
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((item) => (
              <SponsorCard
                key={item.id}
                item={item}
                canManage={canManage}
                disabled={busy}
                archived
                send={send}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SponsorCard({
  item,
  canManage,
  disabled,
  archived = false,
  first,
  last,
  moveEarlier,
  moveLater,
  send,
}: {
  item: Item;
  canManage: boolean;
  disabled: boolean;
  archived?: boolean;
  first?: boolean;
  last?: boolean;
  moveEarlier?: () => void;
  moveLater?: () => void;
  send: (body: FormData | object, method?: string) => Promise<void>;
}) {
  const [name, setName] = useState(item.display_name);
  const [alt, setAlt] = useState(item.alt_text);
  const [broken, setBroken] = useState(false);
  return (
    <article className="panel !p-4">
      <div className="aspect-square w-full rounded-xl bg-white p-4 sponsor-square">
        {item.imageUrl && !broken ? (
          <img
            src={item.imageUrl}
            alt={item.alt_text}
            onError={() => setBroken(true)}
          />
        ) : (
          <div
            className="grid h-full place-items-center text-center text-sm text-slate-700"
            role="status"
          >
            Preview expired or unavailable. Refresh to retry.
          </div>
        )}
      </div>
      {canManage ? (
        <>
          <label className="mt-3 block text-sm font-bold">
            Display name
            <input
              className="mt-1 w-full rounded-lg bg-slate-800 p-3"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="mt-3 block text-sm font-bold">
            Image alt text
            <input
              className="mt-1 w-full rounded-lg bg-slate-800 p-3"
              value={alt}
              maxLength={240}
              onChange={(e) => setAlt(e.target.value)}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="btn-secondary min-h-11"
              disabled={disabled}
              onClick={() =>
                send({
                  action: "rename",
                  sponsorId: item.id,
                  displayName: name,
                  altText: alt,
                })
              }
            >
              Save details
            </button>
            {archived ? (
              <button
                className="btn min-h-11"
                disabled={disabled}
                onClick={() => send({ action: "restore", sponsorId: item.id })}
              >
                Restore
              </button>
            ) : (
              <button
                className="btn-secondary min-h-11"
                disabled={disabled}
                onClick={() => send({ action: "archive", sponsorId: item.id })}
              >
                Archive
              </button>
            )}
            {!archived && (
              <>
                <button
                  className="btn-secondary min-h-11"
                  disabled={disabled || first}
                  onClick={moveEarlier}
                >
                  Move earlier
                </button>
                <button
                  className="btn-secondary min-h-11"
                  disabled={disabled || last}
                  onClick={moveLater}
                >
                  Move later
                </button>
              </>
            )}
            {!archived && (
              <label className="btn-secondary col-span-2 flex min-h-11 cursor-pointer items-center justify-center">
                Replace image
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={disabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.append("file", file);
                    form.append("sponsorId", item.id);
                    form.append("displayName", name);
                    form.append("altText", alt);
                    void send(form);
                  }}
                />
              </label>
            )}
          </div>
        </>
      ) : (
        <div className="mt-3">
          <h3 className="font-bold">{item.display_name}</h3>
          <p className="text-sm text-slate-400">{item.alt_text}</p>
        </div>
      )}
    </article>
  );
}
