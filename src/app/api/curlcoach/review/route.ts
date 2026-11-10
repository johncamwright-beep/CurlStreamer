import { NextResponse } from "next/server";
import { labEnabled, sameOrigin } from "@/lib/curlcoach/access";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { reviewCorrectionSchema } from "@/lib/curlcoach/flagged-shots";
import { currentShots, emptyState } from "@/lib/curlcoach/model";
import {
  recordingLink,
  withBroadcastReview,
  withRecordedReviewTime,
  youtubeId,
} from "@/lib/curlcoach/review";
import { standaloneReviewVideo } from "@/lib/curlcoach/standalone-review";
import { loadCoachState } from "@/lib/providers/curlcoach-store";
import { loadCoachBroadcastReviews } from "@/lib/providers/curlcoach-video";
import { loadReviewCorrections } from "@/lib/providers/shot-review-corrections";
import { loadStandaloneReviews } from "@/lib/providers/standalone-reviews";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (process.env.CURLCOACH_ENABLED !== "true" || labEnabled())
    return new NextResponse(null, { status: 404, headers });
  if (!sameOrigin(request))
    return new NextResponse(null, { status: 403, headers });
  try {
    const account = await requireCoachAccount();
    if (!account) return new NextResponse(null, { status: 403, headers });
    const parsed = reviewCorrectionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: "Enter a valid video time and note." },
        { status: 400, headers },
      );
    const input = parsed.data;
    // This scoped state read also authorizes the game before reading its recording.
    const state = await loadCoachState(
      {
        organizationId: account.organizationId,
        actorUserId: account.userId,
        gameId: input.gameId,
      },
      {
        ...emptyState(),
        organizationId: account.organizationId,
        gameId: input.gameId,
        roster: [],
      },
    );
    const gameIds = [input.gameId];
    const loadRecordings = () =>
      loadCoachBroadcastReviews(
        account.organizationId,
        gameIds,
        account.userId,
      );
    let url: string | null;
    if ("reviewId" in input) {
      const reviews = await loadStandaloneReviews(
        account,
        gameIds,
        input.reviewId,
      );
      const review = reviews[input.gameId]?.find(
        (r) => r.id === input.reviewId,
      );
      if (!review) return new NextResponse(null, { status: 404, headers });
      const broadcast = review.videoReview
        ? undefined
        : (await loadRecordings())[input.gameId];
      url = recordingLink(standaloneReviewVideo(review, broadcast));
    } else {
      const shot = currentShots(state.events).find(
        (s) => s.id === input.shotId,
      );
      if (!shot || !(shot.flagged ?? !!shot.review))
        return new NextResponse(null, { status: 404, headers });
      const [broadcasts, corrections] = await Promise.all([
        loadRecordings(),
        loadReviewCorrections(account, gameIds),
      ]);
      const correction = corrections[input.gameId]?.find(
        (candidate) => candidate.shotId === shot.id,
      );
      url = recordingLink(
        correction?.video ??
          withBroadcastReview(
            withRecordedReviewTime(shot, state.events),
            broadcasts[input.gameId],
          ).videoReview,
      );
    }
    const id = url ? youtubeId(new URL(url)) : null;
    if (!id)
      return NextResponse.json(
        { error: "This game needs a linked YouTube recording first." },
        { status: 409, headers },
      );
    const { error } = await createAdminSupabaseClient().rpc(
      "reviewId" in input
        ? "save_standalone_review_correction"
        : "save_shot_tracker_review_correction",
      {
        p_actor: account.userId,
        p_org: account.organizationId,
        p_game: input.gameId,
        ...("reviewId" in input
          ? { p_review: input.reviewId }
          : { p_shot: input.shotId }),
        p_request: input.requestId,
        p_url: `https://www.youtube.com/watch?v=${id}`,
        p_start: input.startSeconds,
        p_note: input.note,
      },
    );
    if (error) throw new Error("save failed");
    return NextResponse.json({ saved: true }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Could not save the review correction. Please retry." },
      { status: 503, headers },
    );
  }
}
