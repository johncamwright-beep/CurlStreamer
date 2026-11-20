import type { Workspace } from "./event";
import type { State } from "./model";

const revision = (state: State) => state.revision ?? state.events.length;

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
        game.id === state.gameId && revision(state) >= revision(game.state)
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
  const refreshed = new Map(current.event.games.map((game) => [game.id, game]));
  return {
    ...workspace,
    event: {
      ...workspace.event,
      games: workspace.event.games.flatMap((game) => {
        const next = refreshed.get(game.id);
        if (!next)
          return (game.eventId ?? workspace.event.id) === current.event.id
            ? []
            : [game];
        return [
          {
            ...game,
            broadcastReview: next.broadcastReview,
            reviewCorrections: next.reviewCorrections,
            standaloneReviews: next.standaloneReviews,
            state:
              revision(next.state) >= revision(game.state)
                ? next.state
                : game.state,
          },
        ];
      }),
    },
  };
}
