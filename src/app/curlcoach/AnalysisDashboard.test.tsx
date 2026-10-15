import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyState } from "@/lib/curlcoach/model";
import type { AnalysisShot } from "@/lib/curlcoach/advanced-analysis";
import type { CoachGame } from "@/lib/curlcoach/event";
import AnalysisDashboard, {
  AnalysisNavigation,
  type AnalysisTab,
} from "./AnalysisDashboard";

vi.stubGlobal("React", React);
const shot = (patch: Partial<AnalysisShot> = {}): AnalysisShot => ({
  id: "one",
  gameId: "game",
  playerId: "player",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: "CW C",
  execution: "Make",
  grade: 5,
  deficiency: "Make",
  line: null,
  release: null,
  technical: null,
  review: null,
  excluded: null,
  note: "",
  shotSubtype: "straight_draw",
  intendedWeight: "top_4",
  observedDestination: "top_4",
  resultObservations: [],
  destinationAssessment: "assessed",
  resultAssessment: "assessed",
  analysisStatus: "available",
  analysisUnavailable: false,
  difficulty: "A",
  ...patch,
});
const game: CoachGame = {
  id: "game",
  eventId: "event",
  label: "Game one",
  opponent: "Visitors",
  teamName: "Home",
  scheduledEnds: 8,
  status: "open",
  side: "home",
  initialHammer: null,
  ends: [],
  scoreboardAvailable: false,
  state: emptyState(),
};
function render(tab: AnalysisTab, shots: AnalysisShot[]) {
  return renderToStaticMarkup(
    <AnalysisDashboard
      tab={tab}
      onTabChange={vi.fn()}
      shots={shots}
      games={[game]}
      players={[{ id: "player", name: "Taylor" }]}
    />,
  );
}
describe("Analysis dashboard", () => {
  it("renders four labelled, keyboard-addressable report tabs", () => {
    const html = renderToStaticMarkup(
      <AnalysisNavigation tab="performance" onTabChange={vi.fn()} />,
    );
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html).toContain('aria-selected="true" tabindex="0"');
    expect(html).toContain("Advanced Analysis");
  });
  it("counts zero grades and omits excluded attempts from shooting", () => {
    const html = render("performance", [
      shot(),
      shot({ id: "two", grade: 0 }),
      shot({ id: "excluded", grade: null, excluded: "Pick" }),
    ]);
    expect(html).toContain("50.0%");
    expect(html).toContain("2 graded shots");
    expect(html).not.toContain("3 graded shots");
    expect(html).toContain("Shooting percentage by game");
  });
  it("uses classified execution as miss denominator and includes missing reasons", () => {
    const html = render("misses", [
      shot({ execution: "Xmiss", deficiency: null }),
      shot({ id: "two", execution: null, deficiency: "Heavy", grade: 0 }),
      shot({ id: "three" }),
    ]);
    expect(html).toContain("50.0%");
    expect(html).toContain("1 of 2 recorded outcomes");
    expect(html).toContain("Not recorded");
    expect(html).toContain("0<small> / 1</small>");
  });
  it("preserves an explicit no-deficiency assessment on a missed execution", () => {
    const html = render("misses", [
      shot({ execution: "Partial", deficiency: "Make" }),
      shot({ id: "two", execution: "Xmiss", deficiency: null }),
    ]);
    expect(html).toContain("1<small> / 2</small>");
    expect(html).toContain("1 not recorded");
    expect(html).toMatch(
      /No deficiency<\/span>.*?50\.0%.*?analysis-count\">1<\/span>/,
    );
    expect(html).toMatch(
      /Not recorded<\/span>.*?50\.0%.*?analysis-count\">1<\/span>/,
    );
    expect(html).toContain("No recorded miss patterns");
  });
  it("uses all classified untyped shots as the practice priority denominator", () => {
    const html = render("misses", [
      ...Array.from({ length: 10 }, (_, index) =>
        shot({
          id: `untyped-${index}`,
          type: null,
          grade: null,
          execution: index < 2 ? "Partial" : "Make",
          deficiency: index < 2 ? "Light" : "Make",
        }),
      ),
      shot({ id: "typed", execution: "Partial", deficiency: "Light" }),
    ]);
    expect(html).toContain("Light · Type not recorded");
    expect(html).toContain("2 / 10 recorded outcomes");
    expect(html).toContain("20.0%");
    expect(html).not.toContain("2 / 2 recorded outcomes");
  });
  it("keeps assessed empty results separate from missing and deduplicates tags per shot", () => {
    const html = render("advanced", [
      shot(),
      shot({ id: "two", resultObservations: ["light", "light"] }),
      shot({
        id: "three",
        resultObservations: null,
        resultAssessment: "not_assessed",
      }),
    ]);
    expect(html).toContain('aria-label="Result observations"');
    expect(html).toContain("2 / 3 assessed");
    expect(html).toContain("Light");
    expect(html).toContain("50.0%");
    expect(html).toContain("<dt>No observed miss</dt><dd>1</dd>");
    expect(html).toContain("<dt>Not assessed</dt><dd>1</dd>");
    expect(html).not.toContain("After contact");
    expect(html).not.toContain("Tags may overlap");
  });
  it("renders independent technical coverage with absent observations", () => {
    const html = render("technical", [
      shot({ line: "On broom" }),
      shot({ id: "two", line: null }),
    ]);
    expect(html).toContain('aria-label="Line accuracy"');
    expect(html).toContain("1 / 2 recorded");
    expect(html).toContain("100.0%");
    expect(html).toContain("1 not recorded");
    expect(html).not.toContain("proof");
  });
  it("shows concise empty states without fabricated chart values", () => {
    expect(render("performance", [])).toContain("No graded shots");
    const html = render("advanced", []);
    expect(html).toContain("No recorded sub-shots");
    expect(html).toContain("No assessed results");
    expect(html).toContain("0 / 0 classified");
  });
});
