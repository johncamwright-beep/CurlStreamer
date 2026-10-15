import { expect, it } from "vitest";
import { reviewLink, videoReviewSchema, withBroadcastReview } from "./review";
import { shotSchema, append, currentShots, emptyState } from "./model";
import { nextTurn } from "./next-turn";
import { gameShots, sampleEvent } from "./event";
const video = {
  url: "https://www.youtube.com/live/abcdefghijk?t=99",
  positionSeconds: 120,
  lookBackSeconds: 30,
};
it("builds stable recording links, clamps to zero and leaves missing timing pending", () => {
  expect(reviewLink(video)).toBe(
    "https://www.youtube.com/watch?v=abcdefghijk&t=90s",
  );
  expect(reviewLink({ ...video, delaySeconds: 15 })).toBe(
    "https://www.youtube.com/watch?v=abcdefghijk&t=105s",
  );
  expect(reviewLink({ ...video, positionSeconds: 5 })).toContain("t=0s");
  expect(reviewLink({ ...video, positionSeconds: null })).toBeNull();
  expect(reviewLink({ ...video, url: "" })).toBeNull();
  expect(
    reviewLink({ ...video, url: "https://youtu.be/abcdefghijk" }),
  ).toContain("t=90s");
});
it("rejects unsafe links and invalid durations at the schema boundary", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "https://user:password@youtube.com/watch?v=abcdefghijk",
  ])
    expect(videoReviewSchema.safeParse({ ...video, url }).success).toBe(false);
  expect(
    videoReviewSchema.safeParse({ ...video, lookBackSeconds: -1 }).success,
  ).toBe(false);
});
it("retains flagged notes and bookmarks in audited corrections and clears them for next turn", () => {
  const { id: _id, ...base } = gameShots(
    sampleEvent("shorty-example").games[0],
  )[0];
  void _id;
  expect(shotSchema.safeParse(base).success).toBe(true);
  const shot = {
    ...base,
    flagged: true,
    videoReview: video,
    note: "Review line call",
  };
  const first = append(
    emptyState(),
    {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      shotId: crypto.randomUUID(),
      shot,
    },
    "coach",
  );
  const corrected = append(
    first,
    {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      shotId: first.events[0].shotId,
      shot: { ...shot, flagged: false },
    },
    "coach",
  );
  expect(first.events[0].shot?.flagged).toBe(true);
  expect(currentShots(corrected.events)[0].flagged).toBe(false);
  expect(nextTurn(shot, [])).toMatchObject({
    flagged: false,
    note: "",
    videoReview: { url: video.url, positionSeconds: null, lookBackSeconds: 30 },
  });
});

it("derives existing flags from actual start, preserves look-back and does not rewrite events", () => {
  const shot = {
    flaggedAt: "2026-09-19T12:20:00Z",
    videoReview: { url: "", positionSeconds: null, lookBackSeconds: 45 },
  };
  const broadcast = {
    url: "https://youtu.be/abcdefghijk",
    startedAt: "2026-09-19T12:00:00Z",
    endedAt: "2026-09-19T14:00:00Z",
  };
  expect(
    reviewLink(withBroadcastReview(shot, broadcast).videoReview),
  ).toContain("t=1155s");
  expect(shot.videoReview.positionSeconds).toBeNull();
  for (const flaggedAt of [
    "2026-09-19T11:59:59Z",
    "2026-09-19T14:00:01Z",
    "invalid",
  ])
    expect(
      withBroadcastReview({ ...shot, flaggedAt }, broadcast).videoReview
        .positionSeconds,
    ).toBeNull();
  expect(withBroadcastReview(shot).videoReview.positionSeconds).toBeNull();
  expect(
    withBroadcastReview({ videoReview: video }, broadcast).videoReview,
  ).toEqual(video);
});
