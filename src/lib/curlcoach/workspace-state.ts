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

/** A refreshed event also removes games deleted in Streamer from cached season views. */
export function refreshWorkspaceEvent(
  workspace: Workspace,
  current: Workspace,
): Workspace {
  if (
    workspace.event.organizationId !== current.event.organizationId ||
    workspace.event.source !== current.event.source
  )
    return workspace;
  const ids = new Set(current.event.games.map((game) => game.id));
  const retained = {
    ...workspace,
    event: {
      ...workspace.event,
      games: workspace.event.games.filter(
        (game) =>
          (game.eventId ?? workspace.event.id) !== current.event.id ||
          ids.has(game.id),
      ),
    },
  };
  return current.event.games.reduce(
    (result, game) => updateWorkspaceState(result, game.state),
    retained,
  );
}
