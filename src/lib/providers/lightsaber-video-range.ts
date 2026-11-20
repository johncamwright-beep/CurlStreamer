/** Single bounded byte range; multipart/invalid ranges are rejected. */
export function lightsaberByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | undefined {
  if (header === undefined) return undefined;
  const parsed = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!parsed || (!parsed[1] && !parsed[2]) || size <= 0) return null;
  let start: number, end: number;
  if (!parsed[1]) {
    const suffix = Number(parsed[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(parsed[1]);
    end = parsed[2] ? Math.min(Number(parsed[2]), size - 1) : size - 1;
  }
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start < size &&
    end >= start
    ? { start, end }
    : null;
}
