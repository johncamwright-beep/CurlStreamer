import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyState, setLineup, type State } from "@/lib/curlcoach/model";

vi.stubGlobal("React", React);
import CoachLab from "./CoachLab";

function state(status: "open" | "closed", roster: State["roster"]): State {
  return {
    ...emptyState(),
    organizationId: "00000000-0000-4000-8000-000000000001",
    gameId: "00000000-0000-4000-8000-000000000002",
    status,
    roster,
  };
}

function render(
  status: "open" | "closed",
  roster: State["roster"],
  started = false,
) {
  const initialState = started
    ? {
        ...setLineup(
          state("open", roster),
          {
            action: "set-lineup",
            lineup: Array(8).fill(roster![0].id),
            requestId: "00000000-0000-4000-8000-000000000004",
            expectedRevision: 0,
          },
          "coach",
        ),
        status,
      }
    : state(status, roster);
  return renderToStaticMarkup(
    <CoachLab
      unlocked
      context={{
        source: "streamer",
        eventId: "00000000-0000-4000-8000-000000000003",
        gameId: initialState.gameId,
        initialState,
        onSaved: vi.fn(),
      }}
    />,
  );
}

describe("production CoachLab session state", () => {
  const players = [
    {
      id: "stable-player-id",
      name: "Taylor",
      position: "Lead" as const,
    },
  ];

  it("requires lineup confirmation before a new game can be charted", () => {
    const html = render("open", players);
    expect(html).toContain("Start Charting");
    expect(html).not.toContain("Chart an attempt");
    expect(html).not.toContain("Finish private coaching session");
  });

  it("uses the private roster identity after lineup confirmation", () => {
    const html = render("open", players, true);

    expect(html).toContain('value="stable-player-id"');
    expect(html).toContain("Finish private coaching session");
  });

  it("shows only a closed panel and explicit reopen control for finished games", () => {
    const closed = render("closed", players, true);
    expect(closed).toContain("Game closed");
    expect(closed).toContain("Reopen");
    expect(closed).not.toContain("Finish private coaching session");
    expect(closed).not.toContain("<fieldset");
    expect(closed).not.toContain("Game actions");
    expect(closed).not.toContain("Recorded attempts");
  });

  it("blocks charting with no roster and directs the coach to team setup", () => {
    const html = render("open", []);

    expect(html).toContain("Add your team roster before charting attempts.");
    expect(html).toContain('href="/account"');
    expect(html).toContain("<button disabled");
    expect(html).not.toContain("Chart an attempt");
  });
});
