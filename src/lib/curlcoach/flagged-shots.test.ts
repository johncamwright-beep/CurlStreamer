import { expect, it } from "vitest";
import {
  parseReviewTime,
  playerReportFlags,
  withReportFlags,
} from "./flagged-shots";
import { gameShots, sampleEvent } from "./event";
import { withRecordedReviewTime } from "./review";
import type { ReportPacket } from "./reports";

it("routes standalone reviews without adding any scored attempts", () => {
  const event = sampleEvent("shorty-example");
  event.games = [event.games[0]];
  const game = event.games[0];
  game.state.events = [];
  game.broadcastReview = {
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    startedAt: "2026-11-10T15:00:00Z",
  };
  const base = {
    id: crypto.randomUUID(),
    playerId: null,
    playerName: null,
    note: "Sweep discussion",
    selectedAt: "2026-11-10T15:00:30Z",
  };
  game.standaloneReviews = [
    { ...base, audience: "team" },
    {
      ...base,
      id: crypto.randomUUID(),
      audience: "player",
      playerId: "lead",
      playerName: "Alex",
    },
  ];
  expect(gameShots(game)).toEqual([]);
  expect(playerReportFlags(event, "lead")).toHaveLength(1);
  expect(playerReportFlags(event, "other")).toEqual([]);
  const packet = { audience: "team", reports: [{}] } as ReportPacket;
  expect(withReportFlags(packet, event).reports[0].flags).toEqual([
    expect.objectContaining({
      end: null,
      stone: null,
      note: "Sweep discussion",
      url: "https://www.youtube.com/watch?v=abcdefghijk&t=30s",
      estimated: true,
    }),
  ]);

  game.standaloneReviews[0] = {
    ...game.standaloneReviews[0],
    note: "Start at the release",
    videoReview: {
      url: "https://youtu.be/abcdefghijk",
      positionSeconds: 42,
      lookBackSeconds: 0,
    },
  };
  game.broadcastReview = {
    url: "https://youtu.be/SecondVideo",
    startedAt: "2026-11-10T15:00:00Z",
  };
  expect(withReportFlags(packet, event).reports[0].flags).toEqual([
    expect.objectContaining({
      note: "Start at the release",
      url: "https://www.youtube.com/watch?v=abcdefghijk&t=42s",
      estimated: false,
    }),
  ]);
  expect(gameShots(game)).toEqual([]);
});

it("parses exact video times without applying look-back twice", () => {
  expect(parseReviewTime("2:12")).toBe(132);
  expect(parseReviewTime("1:02:12")).toBe(3732);
  expect(parseReviewTime("0:00")).toBe(0);
  for (const invalid of [
    "2:99",
    "1:60:00",
    "-1:00",
    "2.12",
    "999:00:00",
    "2:1",
    "",
  ])
    expect(parseReviewTime(invalid)).toBeNull();
});
it("restores legacy review save time as approximate without altering the saved events", () => {
  const game = sampleEvent("shorty-example").games[0];
  const shot = gameShots(game)[0];
  const events = [
    {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      revision: 1,
      shotId: shot.id,
      shot: {
        ...shot,
        flagged: undefined,
        flaggedAt: undefined,
        review: "Player" as const,
      },
      actor: "coach",
      at: "2026-10-10T12:00:00Z",
    },
  ];
  const derived = withRecordedReviewTime(
    { ...shot, flagged: undefined, flaggedAt: undefined, review: "Player" },
    events,
  );
  expect(derived.flaggedAt).toBe(events[0].at);
  expect(derived.videoReview?.estimated).toBe(true);
  expect(events[0].shot.flaggedAt).toBeUndefined();
  expect(
    withRecordedReviewTime(
      { ...shot, flagged: false, flaggedAt: undefined },
      events,
    ).flaggedAt,
  ).toBeUndefined();
});
it("overrides timing and notes for only the matching player's flag, including closed games", () => {
  const event = sampleEvent("shorty-example");
  event.games = [event.games[0]];
  const game = event.games[0],
    shot = gameShots(game)[0];
  game.state.events = [
    {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      revision: 1,
      shotId: shot.id,
      shot: { ...shot, flagged: true },
      actor: "coach",
      at: "2026-10-10T12:00:00Z",
    },
  ];
  game.state.status = "closed";
  const original = JSON.stringify(game.state);
  game.reviewCorrections = [
    {
      shotId: shot.id,
      note: "Watch the release",
      video: {
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        positionSeconds: 132,
        lookBackSeconds: 0,
      },
    },
  ];
  const flags = playerReportFlags(event, shot.playerId);
  expect(flags[0]).toMatchObject({
    note: "Watch the release",
    url: "https://www.youtube.com/watch?v=abcdefghijk&t=132s",
    estimated: false,
  });
  expect(playerReportFlags(event, "another-player")).toEqual([]);
  expect(JSON.stringify(game.state)).toBe(original);
  const packet = {
    audience: "players",
    reports: [{ playerId: shot.playerId }, { playerId: "another-player" }],
  } as ReportPacket;
  expect(
    withReportFlags(packet, event).reports.map((r) => r.flags?.length),
  ).toEqual([1, 0]);
  expect(
    withReportFlags({ ...packet, audience: "team" }, event).reports[0].flags,
  ).toBeUndefined();
});
