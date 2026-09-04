export const CURRENT_GAME_KEY = "curlcast-current-game";
export const CURRENT_GAME_EVENT = "curlcast-current-game";
export type GameNavigationCapabilities = {
  control: boolean;
  scoring: boolean;
  broadcast: boolean;
  editSchedule: boolean;
  assignOpponent: boolean;
};
export type CurrentGameSelection = {
  id: string;
  title: string;
  scheduledLabel: string;
  capabilities: GameNavigationCapabilities;
};
function validCapabilities(
  value: unknown,
): value is GameNavigationCapabilities {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return [
    "control",
    "scoring",
    "broadcast",
    "editSchedule",
    "assignOpponent",
  ].every((key) => typeof v[key] === "boolean");
}
export function readCurrentGame(storage: Pick<Storage, "getItem">) {
  try {
    const value = JSON.parse(
      storage.getItem(CURRENT_GAME_KEY) ?? "null",
    ) as Record<string, unknown> | null;
    if (
      value &&
      typeof value.id === "string" &&
      typeof value.title === "string" &&
      typeof value.scheduledLabel === "string" &&
      validCapabilities(value.capabilities)
    )
      return value as CurrentGameSelection;
  } catch {
    /* Ignore malformed device-local state. */
  }
  return null;
}
export function selectCurrentGame(
  storage: Pick<Storage, "setItem">,
  selection: CurrentGameSelection,
) {
  storage.setItem(CURRENT_GAME_KEY, JSON.stringify(selection));
  globalThis.dispatchEvent?.(
    new CustomEvent<CurrentGameSelection>(CURRENT_GAME_EVENT, {
      detail: selection,
    }),
  );
}
export function clearCurrentGame(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(CURRENT_GAME_KEY);
  globalThis.dispatchEvent?.(
    new CustomEvent<null>(CURRENT_GAME_EVENT, { detail: null }),
  );
}
export function gameCapabilities(
  role: string,
  opponentTbd: boolean,
): GameNavigationCapabilities {
  const organizer =
    role === "owner" || role === "team_admin" || role === "organizer";
  const scorer = organizer || role === "scorer";
  return {
    control: organizer,
    scoring: scorer && !opponentTbd,
    broadcast: scorer,
    editSchedule: organizer,
    assignOpponent: organizer && opponentTbd,
  };
}
