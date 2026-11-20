import { expect, it } from "vitest";
import { gameShots, sampleEvent } from "./event";
import { reportAnalysis, withReportAnalysis } from "./report-analysis";
import type { ReportPacket } from "./reports";

it("uses scoped charting for performance, misses, technique, and linked notes", () => {
  const event = sampleEvent("shorty-example");
  event.games = event.games.slice(0, 2);
  const [first, second] = event.games;
  const sample = gameShots(first)[0];
  const shots = [
    {
      ...sample,
      playerId: "lead",
      type: "Draw",
      turn: "CW S",
      grade: 0,
      execution: "Xmiss",
      deficiency: "Light",
      line: "Wide",
      flagged: true,
      excluded: null,
    },
    { ...sample, playerId: "lead", grade: 5, excluded: "Pick", flagged: false },
    {
      ...sample,
      playerId: "second",
      type: "Peel",
      grade: 5,
      execution: "Make",
      flagged: true,
      flagAudience: "team",
      note: "Watch the hit as a team",
      excluded: null,
    },
  ] as const;
  first.state.events = shots.map((shot, index) => ({
    requestId: `request-${index}`,
    expectedRevision: index,
    revision: index + 1,
    shotId: `shot-${index}`,
    shot: { ...shot, id: `shot-${index}` },
    actor: "coach",
    at: "2026-10-10T12:00:00Z",
  }));
  second.state.events = [];
  first.reviewCorrections = [
    {
      shotId: "shot-0",
      note: "Review the wide release",
      video: {
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        positionSeconds: 132,
        lookBackSeconds: 0,
      },
    },
  ];

  const player = reportAnalysis(event, "lead");
  expect(player.overview[0]).toMatchObject({ percent: 0, graded: 1, shots: 1 });
  expect(player.games.map((game) => game.percent)).toEqual([0, null]);
  expect(player.shotTypes.map((shot) => shot.label)).toEqual(["Draw"]);
  expect(player.turns.map((turn) => turn.label)).toEqual(["CW S"]);
  expect(player.misses).toMatchObject({ misses: 1, classified: 1 });
  expect(player.technical[0]).toMatchObject({ field: "line", recorded: 1 });

  const packet = {
    audience: "players",
    reports: [{ playerId: "lead" }, { playerId: "second" }, {}],
  } as ReportPacket;
  const [lead, teammate, legacy] = withReportAnalysis(packet, event).reports;
  expect(lead.analysis).toEqual(player);
  expect(lead.flags).toEqual([
    expect.objectContaining({
      note: "Review the wide release",
      url: "https://www.youtube.com/watch?v=abcdefghijk&t=132s",
    }),
  ]);
  expect(teammate.analysis?.overview[0].percent).toBe(100);
  expect(teammate.flags).toEqual([]);
  expect(legacy.analysis).toBeUndefined();
  const [team] = withReportAnalysis(
    { ...packet, audience: "team" },
    event,
  ).reports;
  expect(team.analysis?.overview[0].percent).toBe(50);
  expect(team.flags).toEqual([
    expect.objectContaining({
      note: "Watch the hit as a team",
      shooter: "Blair (Second)",
    }),
  ]);
  expect(packet.reports[0].analysis).toBeUndefined();
});
