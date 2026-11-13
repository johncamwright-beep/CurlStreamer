import { z } from "zod";
import {
  videoReviewSchema,
  withBroadcastReview,
  youtubeId,
  type BroadcastReview,
} from "./review";

const youtubeReviewLeadInSeconds = 7;

export const standaloneShotContextSchema = z.strictObject({
  end: z.number().int().min(1).max(20),
  shot: z.number().int().min(1).max(8),
});
export type StandaloneShotContext = z.infer<typeof standaloneShotContextSchema>;

export const standaloneReviewSchema = z.object({
  id: z.uuid(),
  audience: z.enum(["player", "team"]),
  playerId: z.string().nullable(),
  playerName: z.string().nullable(),
  note: z.string().max(4000),
  selectedAt: z.iso.datetime(),
  shotContext: standaloneShotContextSchema.optional(),
  videoReview: videoReviewSchema.optional(),
});
export type StandaloneReview = z.infer<typeof standaloneReviewSchema>;
export function standaloneReviewVideo(
  review: StandaloneReview,
  broadcast?: BroadcastReview,
) {
  const { videoReview } = withBroadcastReview(
    {
      flaggedAt: review.selectedAt,
      videoReview: review.videoReview ?? {
        url: "",
        positionSeconds: null,
        lookBackSeconds: 0,
        estimated: true,
      },
    },
    broadcast,
  );
  // Add context after mapping the selected frame to its recording. A saved
  // manual correction already specifies the exact starting second.
  if (
    !review.videoReview &&
    videoReview.positionSeconds !== null &&
    youtubeId(new URL(videoReview.url))
  )
    return { ...videoReview, lookBackSeconds: youtubeReviewLeadInSeconds };
  return videoReview;
}
