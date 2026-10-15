import { describe, expect, it } from "vitest";
import { sampleEvent } from "./event";
import { updateWorkspaceState, refreshWorkspaceEvent } from "./workspace-state";

describe("confirmed workspace saves", () => {
  const workspace = () => ({
    event: sampleEvent("practice"),
    catalog: [],
    refreshedAt: "now",
  });
  it("removes a deleted game's shots from cached statistics without removing other events", () => {
    const data = workspace();
    const other = {
      ...data.event.games[0],
      id: "other-game",
      eventId: "other-event",
    };
    data.event.games.push(other);
    const refreshed = workspace();
    refreshed.event.games = [];
    expect(refreshWorkspaceEvent(data, refreshed).event.games).toEqual([other]);
    expect(data.event.games).toHaveLength(2);
    refreshed.event.organizationId = "another-team";
    expect(refreshWorkspaceEvent(data, refreshed)).toBe(data);
  });
  it("updates only the saved game and keeps other games intact", () => {
    const data = workspace();
    const state = { ...data.event.games[0].state, revision: 12 };
    const result = updateWorkspaceState(data, state);
    expect(result.event.games[0].state).toBe(state);
    expect(data.event.games[0].state).not.toBe(state);
  });
  it("never moves a newer response backward or crosses an organization", () => {
    const data = workspace();
    data.event.games[0].state.revision = 12;
    const older = { ...data.event.games[0].state, revision: 11 };
    expect(
      updateWorkspaceState(data, older).event.games[0].state.revision,
    ).toBe(12);
    expect(
      updateWorkspaceState(data, {
        ...older,
        organizationId: "another-team",
        revision: 13,
      }),
    ).toBe(data);
  });
});
