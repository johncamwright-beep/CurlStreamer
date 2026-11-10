import { z } from "zod";
import { withBroadcastReview, type BroadcastReview } from "./review";

export const standaloneReviewSchema = z.object({
  id: z.uuid(),
  audience: z.enum(["player", "team"]),
  playerId: z.string().nullable(),
  playerName: z.string().nullable(),
  note: z.string().max(2000),
  selectedAt: z.iso.datetime(),
});
export type StandaloneReview = z.infer<typeof standaloneReviewSchema>;
export function standaloneReviewVideo(
  review: StandaloneReview,
  broadcast?: BroadcastReview,
) {
  return withBroadcastReview(
    {
      flaggedAt: review.selectedAt,
      videoReview: {
        url: "",
        positionSeconds: null,
        lookBackSeconds: 0,
        estimated: true,
      },
    },
    broadcast,
  ).videoReview;
}
