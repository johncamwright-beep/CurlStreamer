import type { Workspace } from "./event";
import type { State } from "./model";

/** Merge confirmed saves into loaded views without another season download. */
export function updateWorkspaceState(
  workspace: Workspace,
  state: State,
): Workspace {
  if (workspace.event.organizationId !== state.organizationId) return workspace;
  return {
    ...workspace,
    event: {
      ...workspace.event,
      games: workspace.event.games.map((game) =>
        game.id === state.gameId &&
        (state.revision ?? state.events.length) >=
          (game.state.revision ?? game.state.events.length)
          ? { ...game, state }
          : game,
      ),
    },
  };
}
