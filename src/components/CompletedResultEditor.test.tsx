import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CompletedResultEditor } from "./CompletedResultEditor";
import type { EditableCompletedResult } from "@/lib/completed-result-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

const snapshot: EditableCompletedResult = {
  revision: 2,
  completion: {
    status: "completed",
    eventName: "Club night",
    homeName: "Birch",
    awayName: "Maple",
    completedAt: "2026-10-05T12:00:00Z",
    youtubeWatchUrl: null,
    result: {
      outcome: "home_win",
      label: "Home win",
      totals: { home: 2, away: 0 },
      ends: [
        { end: 1, team: "home", points: 2, blank: false },
        { end: 2, team: null, points: 0, blank: true },
      ],
    },
  },
};

describe("completed result editor", () => {
  it("shows saved end scores, labelled scoring controls, a draft preview and mandatory correction reason", () => {
    const html = renderToStaticMarkup(
      <CompletedResultEditor gameId="game" initialSnapshot={snapshot} />,
    );
    expect(html).toContain("Saved final score");
    expect(html).toContain("Birch 2 – 0 Maple");
    expect(html).toContain('aria-label="End 1 scoring team"');
    expect(html).toContain('aria-label="End 2 points"');
    expect(html).toContain('value="blank" selected=""');
    expect(html).toContain("Draft score:");
    expect(html).toContain("Reason for correction");
    expect(html).toContain('maxLength="500" required=""');
    expect(html).toContain("Save corrected result");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("Camera");
    expect(html).not.toContain("Reopen");
  });

  it("starts no-result games with an explicit no-result choice and no invented scored ends", () => {
    const value: EditableCompletedResult = {
      ...snapshot,
      completion: {
        ...snapshot.completion,
        result: {
          outcome: "no_result",
          label: "No result recorded",
          totals: null,
          ends: [],
        },
      },
    };
    const html = renderToStaticMarkup(
      <CompletedResultEditor gameId="game" initialSnapshot={value} />,
    );
    expect(html).toContain('type="checkbox" checked=""');
    expect(html).toContain("No result recorded");
    expect(html).not.toContain('aria-label="End 1 scoring team"');
  });

  it("offers loading rather than a fabricated result when no saved snapshot is available", () => {
    const html = renderToStaticMarkup(<CompletedResultEditor gameId="game" />);
    expect(html).toContain("Load saved result");
    expect(html).not.toContain("Save corrected result");
    expect(html).not.toContain("Draft score:");
  });
});
