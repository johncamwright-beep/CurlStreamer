import { z } from "zod";
import type { ShotEvent } from "./model";

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
    estimated: z.boolean().optional(),
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

export type BroadcastReview = {
  url: string;
  startedAt?: string;
  endedAt?: string;
  estimated?: boolean;
};
/** Older category-only flags did not capture flaggedAt. Use their first review
 * save as an explicitly approximate display timestamp; never mutate the audit. */
export function withRecordedReviewTime<
  T extends {
    id: string;
    flagged?: boolean;
    review?: string | null;
    flaggedAt?: string;
    videoReview?: VideoReview;
  },
>(shot: T, events: ShotEvent[]): T {
  if (shot.flaggedAt || !(shot.flagged ?? !!shot.review)) return shot;
  const saved = events.find(
    (event) =>
      event.shotId === shot.id &&
      event.shot &&
      (event.shot.flagged ?? !!event.shot.review),
  );
  if (!saved) return shot;
  return {
    ...shot,
    flaggedAt: saved.at,
    videoReview: {
      url: "",
      positionSeconds: null,
      lookBackSeconds: 30,
      ...shot.videoReview,
      estimated: true,
    },
  };
}
/** Derived display metadata only: never rewrite the coach's append-only events. */
export function withBroadcastReview<
  T extends { flaggedAt?: string; videoReview?: VideoReview },
>(shot: T, broadcast?: BroadcastReview): T {
  if (
    reviewLink(shot.videoReview) ||
    !broadcast ||
    !supportedVideo(broadcast.url)
  )
    return shot;
  const recording = {
    ...shot,
    videoReview: {
      ...shot.videoReview,
      url: broadcast.url,
      positionSeconds: null,
      lookBackSeconds: shot.videoReview?.lookBackSeconds ?? 30,
    },
  };
  if (!shot.flaggedAt || !broadcast.startedAt) return recording;
  const at = Date.parse(shot.flaggedAt),
    start = Date.parse(broadcast.startedAt);
  const end = broadcast.endedAt ? Date.parse(broadcast.endedAt) : Infinity;
  if (
    !supportedVideo(broadcast.url) ||
    !Number.isFinite(at) ||
    !Number.isFinite(start) ||
    Number.isNaN(end) ||
    at < start ||
    at > end
  )
    return recording;
  const positionSeconds = Math.floor((at - start) / 1000);
  if (positionSeconds > 604800) return recording;
  return {
    ...shot,
    videoReview: {
      url: broadcast.url,
      positionSeconds,
      lookBackSeconds: shot.videoReview?.lookBackSeconds ?? 30,
      delaySeconds: shot.videoReview?.delaySeconds ?? 0,
      ...(broadcast.estimated || shot.videoReview?.estimated
        ? { estimated: true }
        : {}),
    },
  };
}
