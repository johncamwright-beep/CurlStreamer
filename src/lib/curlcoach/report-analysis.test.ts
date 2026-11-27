import { expect, it } from "vitest";
import { gameShots, sampleEvent } from "./event";
import { reportAnalysis, withReportAnalysis } from "./report-analysis";
import { reportContent } from "./report-content";
import { difficultyIdentity } from "./difficulty";
import type { ReportPacket } from "./reports";

it("renders checkpoint notes without loaded matrices and serves legacy tabs on the same packet", () => {
  const finding = {
    text: "Your draws repeatedly overcurled.",
    evidence: ["event-1"],
  };
  const trend = { text: "Your guards improved.", evidence: ["events-1"] };
  const saved = {
    key: "player-1",
    title: "Lead",
    evidence: [],
    limitations: [],
    narrative: { eventStats: [finding], eventTrends: [trend] },
  };
  expect(
    reportContent(saved).map((b) => (b.kind === "text" ? b.value : b.kind)),
  ).toEqual(["heading", finding.text, "heading", trend.text]);
  const packet: ReportPacket = {
    audience: "players",
    eventName: "Qualifier",
    policy: "shot-tracker-event-v12",
    generatedAt: "now",
    reports: [saved],
  };
  const [view] = withReportAnalysis(packet, sampleEvent("practice")).reports;
  expect(view.narrative).toMatchObject({
    summary: finding,
    strengths: [],
    priorities: [],
    practice: [],
    review: [],
    acrossGames: [trend],
    eventStats: [finding],
    eventTrends: [trend],
  });
  expect(saved.narrative).not.toHaveProperty("summary");
});
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
      release: "Soft",
      technical: "Understep",
      flagged: true,
      excluded: null,
    },
    { ...sample, playerId: "lead", grade: 5, excluded: "Pick", flagged: false },
    {
      ...sample,
      playerId: "second",
      type: "Peel",
      deficiency: "Overcurl",
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
  first.analysisReady = true;
  first.analysisRecords = [
    {
      shotId: "shot-0",
      identity: difficultyIdentity(shots[0]),
      revision: 1,
      shotSubtype: null,
      intendedWeight: null,
      observedDestination: null,
      destinationAssessment: "not_assessed",
      resultAssessment: "assessed",
      resultObservations: ["light", "overswept"],
      observedMisses: ["overswept"],
      additionalTechnical: ["Understep", "Fishtail"],
      analysisStatus: "available",
    },
  ];
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
  expect(player.shotReview?.reasons).toMatchObject({
    tagged: 1,
    counts: { Light: 1, Overswept: 1 },
  });
  expect(player.technical[0]).toMatchObject({ field: "line", recorded: 1 });

  const packet = {
    audience: "players",
    reports: [{ playerId: "lead" }, { playerId: "second" }, {}],
  } as ReportPacket;
  const [lead, teammate, legacy] = withReportAnalysis(packet, event).reports;
  expect(lead.analysis).toEqual(player);
  expect(lead.missesByGame?.map((g) => g.shots.length)).toEqual([1, 0]);
  expect(lead.missesByGame?.[0].shots[0]).toMatchObject({
    type: "Draw",
    outcome: "Complete miss",
    technical: ["Wide", "Soft", "Understep", "Fishtail"],
    tags: ["Light", "Overswept"],
    flag: { url: "https://www.youtube.com/watch?v=abcdefghijk&t=132s" },
  });
  expect(teammate.missesByGame?.[0].shots).toEqual([
    expect.objectContaining({ type: "Peel", tags: ["Overcurl"] }),
  ]);
  expect(teammate.missesByGame?.[0].shots[0]).not.toHaveProperty("flag");
  expect(legacy.missesByGame).toBeUndefined();
  expect(lead.flags).toEqual([
    expect.objectContaining({
      note: "Review the wide release",
      url: "https://www.youtube.com/watch?v=abcdefghijk&t=132s",
    }),
  ]);
  expect(teammate.analysis?.overview[0].percent).toBe(100);
  expect(teammate.flags).toEqual([]);
  expect(lead.playerComparison).toBeUndefined();
  expect(legacy.analysis).toBeUndefined();
  const [team] = withReportAnalysis(
    { ...packet, audience: "team" },
    event,
  ).reports;
  expect(team.analysis?.overview[0].percent).toBe(50);
  expect(team.playerComparison).toBeUndefined();
  expect(team.missesByGame?.[0].shots).toHaveLength(2);
  expect(
    team.missesByGame?.[0].shots.find((s) => s.type === "Draw"),
  ).not.toHaveProperty("flag");
  expect(
    team.missesByGame?.[0].shots.find((s) => s.type === "Peel"),
  ).toHaveProperty("flag");
  const [coach] = withReportAnalysis(
    { ...packet, audience: "coach", reports: [{}] as ReportPacket["reports"] },
    event,
  ).reports;
  expect(
    coach.playerComparison?.map((p) => [p.shooting, p.adjusted, p.graded]),
  ).toEqual([
    [0, null, 1],
    [100, null, 1],
  ]);
  expect(team.flags).toEqual([
    expect.objectContaining({
      note: "Watch the hit as a team",
      shooter: "Blair (Second)",
    }),
  ]);
  expect(coach.missesByGame?.[0].shots.filter((s) => s.flag)).toHaveLength(2);
  expect(packet.reports[0].analysis).toBeUndefined();
});
