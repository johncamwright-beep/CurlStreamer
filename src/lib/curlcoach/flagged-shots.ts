import { standaloneReviewVideo } from "./standalone-review";
import { z } from "zod";
import { gameShots, type CoachEvent } from "./event";
import { recordingLink, reviewLink, type VideoReview } from "./review";
import type { ReportPacket } from "./reports";

const correctionFields = {
  gameId: z.uuid(),
  requestId: z.uuid(),
  startSeconds: z.number().int().min(0).max(604800),
  note: z.string().max(4000),
};
export const reviewCorrectionSchema = z.union([
  z.strictObject({ ...correctionFields, shotId: z.uuid() }),
  z.strictObject({ ...correctionFields, reviewId: z.uuid() }),
]);
export type ReviewCorrection = {
  shotId: string;
  video: VideoReview;
  note: string;
};
export type ReportFlag = {
  gameId: string;
  shotId: string;
  game: string;
  shooter?: string;
  end: number | null;
  stone: number | null;
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
function reportFlags(
  event: CoachEvent,
  audience: { playerId: string } | "team",
): ReportFlag[] {
  return event.games.flatMap((game) => [
    ...gameShots(game)
      .filter(
        (shot) =>
          (shot.flagged ?? !!shot.review) &&
          (audience === "team"
            ? shot.flagAudience === "team"
            : shot.flagAudience !== "team" &&
              shot.playerId === audience.playerId),
      )
      .map((shot) => ({
        gameId: game.id,
        shotId: shot.id,
        game: `${game.label} · vs ${game.opponent}`,
        ...(audience === "team"
          ? {
              shooter:
                game.state.roster?.find((player) => player.id === shot.playerId)
                  ?.name ??
                game.roster?.find((player) => player.id === shot.playerId)
                  ?.name ??
                shot.position,
            }
          : {}),
        end: shot.end,
        stone: shot.stone,
        type: shot.type ?? "Shot",
        note: shot.note,
        url: reviewLink(shot.videoReview) ?? recordingLink(shot.videoReview),
        estimated: !!shot.videoReview?.estimated,
      })),
    ...(game.standaloneReviews ?? [])
      .filter((review) =>
        audience === "team"
          ? review.audience === "team"
          : review.audience === "player" &&
            review.playerId === audience.playerId,
      )
      .map((review) => {
        const video = standaloneReviewVideo(review, game.broadcastReview);
        return {
          gameId: game.id,
          shotId: review.id,
          game: game.label + " · vs " + game.opponent,
          shooter: review.playerName ?? undefined,
          end: null,
          stone: null,
          type: "Video review",
          note: review.note,
          url: reviewLink(video) ?? recordingLink(video),
          estimated: !!video?.estimated,
        };
      }),
  ]);
}
export function playerReportFlags(event: CoachEvent, playerId: string) {
  return reportFlags(event, { playerId });
}
export function withReportFlags(
  packet: ReportPacket,
  event: CoachEvent,
): ReportPacket {
  const teamFlags =
    packet.audience === "team" ? reportFlags(event, "team") : undefined;
  return {
    ...packet,
    reports: packet.reports.map((report) => ({
      ...report,
      flags:
        packet.audience === "players" && report.playerId
          ? playerReportFlags(event, report.playerId)
          : teamFlags?.length
            ? teamFlags
            : undefined,
    })),
  };
}
