export type PendingSponsorFile = { file: File; id: string };
export type UploadOutcome = PendingSponsorFile & {
  ok: boolean;
  error?: string;
};

export function snapshotSponsorFiles(files: FileList | readonly File[]) {
  return Array.from(files, (file) => ({ file, id: crypto.randomUUID() }));
}

export function sponsorDefaults(filename: string) {
  const name = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return { name: name || "Sponsor", altText: `${name || "Sponsor"} logo` };
}

export async function uploadSponsorFiles(
  pending: readonly PendingSponsorFile[],
  request: (form: FormData) => Promise<Response> = (form) =>
    fetch("/api/sponsors", { method: "POST", body: form }),
  progress?: (completed: number, total: number, filename: string) => void,
): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = [];
  for (const item of pending) {
    const form = new FormData();
    form.set("file", item.file);
    form.set(
      "metadata",
      JSON.stringify([{ id: item.id, ...sponsorDefaults(item.file.name) }]),
    );
    const response = await request(form);
    const body = await response.json().catch(() => null);
    outcomes.push(
      response.ok
        ? { ...item, ok: true }
        : { ...item, ok: false, error: body?.error ?? "Upload failed" },
    );
    progress?.(outcomes.length, pending.length, item.file.name);
  }
  return outcomes;
}
