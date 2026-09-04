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
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name}: the image could not be decoded.`);
  }
  try {
    const size = optimizedDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context)
      throw new Error(`${file.name}: image optimization is unavailable.`);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.88),
    );
    if (!blob || blob.size > 4 * 1024 * 1024)
      throw new Error(`${file.name}: the optimized image exceeds 4 MB.`);
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
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
      JSON.stringify([{ id: item.id, ...sponsorDefaults(item.file.name) }]),
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
