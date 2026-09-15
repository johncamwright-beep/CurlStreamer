import { z } from "zod";

export function supportedVideo(value: string) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return false;
    return [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
    ].includes(url.hostname)
      ? !!youtubeId(url)
      : /\.(mp4|webm|ogg)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
export function youtubeId(url: URL) {
  const id =
    url.hostname === "youtu.be"
      ? url.pathname.slice(1)
      : url.searchParams.get("v") ||
        url.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/)?.[1];
  return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
}
export const videoReviewSchema = z
  .object({
    url: z
      .string()
      .max(2000)
      .refine(
        (value) => value === "" || supportedVideo(value),
        "Use a YouTube recording or a direct MP4, WebM or Ogg video URL.",
      ),
    positionSeconds: z.number().int().min(0).max(604800).nullable(),
    lookBackSeconds: z.number().int().min(0).max(3600),
    delaySeconds: z.number().int().min(0).max(3600).optional(),
  })
  .strict();
export type VideoReview = z.infer<typeof videoReviewSchema>;
export function reviewLink(video?: VideoReview) {
  if (!video || video.positionSeconds === null || !supportedVideo(video.url))
    return null;
  const start = reviewStart(video)!;
  const url = new URL(video.url);
  if (
    ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
      url.hostname,
    )
  )
    return `https://www.youtube.com/watch?v=${youtubeId(url)}&t=${start}s`;
  url.hash = `t=${start}`;
  return url.toString();
}
export function videoTime(seconds: number) {
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function reviewStart(video?: VideoReview) {
  return !video || video.positionSeconds === null
    ? null
    : Math.max(
        0,
        video.positionSeconds +
          (video.delaySeconds ?? 0) -
          video.lookBackSeconds,
      );
}
