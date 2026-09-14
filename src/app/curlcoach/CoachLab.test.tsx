import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyState, type State } from "@/lib/curlcoach/model";

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

function render(status: "open" | "closed", roster: State["roster"]) {
  const initialState = state(status, roster);
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

  it("uses the first private roster identity for a new production draft", () => {
    const html = render("open", players);

    expect(html).toContain('value="stable-player-id"');
    expect(html).toContain("Finish private coaching session");
  });

  it("renders the finish → closed → reopen lifecycle with charting disabled", () => {
    const open = render("open", players);
    const closed = render("closed", players);
    const reopened = render("open", players);

    expect(open).toContain("Finish private coaching session");
    expect(closed).toContain("Private coaching session closed.");
    expect(closed).toContain("Reopen coaching session");
    expect(closed).not.toContain("Finish private coaching session");
    expect(closed).toContain("<fieldset disabled");
    expect(reopened).toContain("Finish private coaching session");
  });

  it("blocks charting with no roster and directs the coach to team setup", () => {
    const html = render("open", []);

    expect(html).toContain("Add your team roster before charting attempts.");
    expect(html).toContain('href="/account"');
    expect(html).toContain("<fieldset disabled");
  });
});
