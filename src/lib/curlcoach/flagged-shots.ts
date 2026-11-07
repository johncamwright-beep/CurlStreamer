import { z } from "zod";
import { gameShots, type CoachEvent } from "./event";
import { reviewLink, supportedVideo, type VideoReview } from "./review";
import type { ReportPacket } from "./reports";

export const reviewCorrectionSchema = z
  .object({
    gameId: z.uuid(),
    shotId: z.uuid(),
    requestId: z.uuid(),
    startSeconds: z.number().int().min(0).max(604800),
    note: z.string().max(4000),
  })
  .strict();
export type ReviewCorrection = {
  shotId: string;
  video: VideoReview;
  note: string;
};
export type ReportFlag = {
  gameId: string;
  shotId: string;
  game: string;
  end: number;
  stone: number;
  type: string;
  note: string;
  url: string | null;
  estimated: boolean;
};
export function parseReviewTime(value: string): number | null {
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value.trim())) return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.at(-1)! > 59 || (parts.length === 3 && parts[1] > 59)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds <= 604800 ? seconds : null;
}
export function playerReportFlags(
  event: CoachEvent,
  playerId: string,
): ReportFlag[] {
  return event.games.flatMap((game) =>
    gameShots(game)
      .filter(
        (shot) => shot.playerId === playerId && (shot.flagged ?? !!shot.review),
      )
      .map((shot) => ({
        gameId: game.id,
        shotId: shot.id,
        game: `${game.label} · vs ${game.opponent}`,
        end: shot.end,
        stone: shot.stone,
        type: shot.type ?? "Shot",
        note: shot.note,
        url:
          reviewLink(shot.videoReview) ??
          (shot.videoReview && supportedVideo(shot.videoReview.url)
            ? shot.videoReview.url
            : null),
        estimated: !!shot.videoReview?.estimated,
      })),
  );
}
export function withReportFlags(
  packet: ReportPacket,
  event: CoachEvent,
): ReportPacket {
  return {
    ...packet,
    reports: packet.reports.map((report) => ({
      ...report,
      flags:
        packet.audience === "players" && report.playerId
          ? playerReportFlags(event, report.playerId)
          : undefined,
    })),
  };
}
