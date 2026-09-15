import { optimizeUploadImage } from "@/lib/optimize-upload-image";
export type PendingSponsorFile = {
  file: File;
  id: string;
  name: string;
  altText: string;
  website?: string;
};
export type UploadOutcome = PendingSponsorFile & {
  ok: boolean;
  error?: string;
};

export function snapshotSponsorFiles(files: FileList | readonly File[]) {
  return Array.from(files, (file) => ({
    file,
    id: crypto.randomUUID(),
    ...sponsorDefaults(file.name),
  }));
}

export function sponsorDefaults(filename: string) {
  const name = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return { name: name || "Sponsor", altText: `${name || "Sponsor"} logo` };
}

/** Returns a canonical sponsor website, or undefined when it was left blank. */
export function normalizeSponsorWebsite(value?: string) {
  const website = value?.trim();
  if (!website) return undefined;
  try {
    const url = new URL(website);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function isSafeSponsorWebsite(value?: string) {
  return !value?.trim() || Boolean(normalizeSponsorWebsite(value));
}

export function optimizedDimensions(
  width: number,
  height: number,
  maximum = 1600,
) {
  const scale = Math.min(1, maximum / width, maximum / height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export async function optimizeSponsorFile(file: File): Promise<File> {
  return optimizeUploadImage(file);
}

export async function uploadSponsorFiles(
  pending: readonly PendingSponsorFile[],
  request: (form: FormData) => Promise<Response> = (form) =>
    fetch("/api/sponsors", { method: "POST", body: form }),
  progress?: (completed: number, total: number, filename: string) => void,
  optimize: (file: File) => Promise<File> = optimizeSponsorFile,
): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = [];
  for (const item of pending) {
    progress?.(outcomes.length, pending.length, `Optimizing ${item.file.name}`);
    let optimized: File;
    try {
      optimized = await optimize(item.file);
    } catch (error) {
      outcomes.push({
        ...item,
        ok: false,
        error:
          error instanceof Error ? error.message : "Image optimization failed",
      });
      progress?.(outcomes.length, pending.length, item.file.name);
      continue;
    }
    const form = new FormData();
    form.set("file", optimized);
    form.set(
      "metadata",
      JSON.stringify([
        {
          id: item.id,
          name: item.name,
          altText: item.altText,
          website: normalizeSponsorWebsite(item.website),
        },
      ]),
    );
    progress?.(outcomes.length, pending.length, `Uploading ${item.file.name}`);
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
