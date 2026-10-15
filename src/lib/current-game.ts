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
export function clearCurrentGameIfMatching(
  storage: Pick<Storage, "getItem" | "removeItem">,
  id: string,
) {
  if (readCurrentGame(storage)?.id !== id) return false;
  clearCurrentGame(storage);
  return true;
}
export function gameCapabilities(
  role: string,
  opponentTbd: boolean,
): GameNavigationCapabilities {
  const organizer =
    role === "owner" ||
    role === "team_admin" ||
    role === "game_operator" ||
    role === "organizer";
  const scorer = organizer || role === "scorer";
  return {
    control: organizer,
    scoring: scorer && !opponentTbd,
    broadcast: scorer,
    editSchedule: organizer,
    assignOpponent: organizer && opponentTbd,
  };
}

export function isCurrentGame(
  start: string | null | undefined,
  timezone = "America/Toronto",
  now = Date.now(),
) {
  if (!start || !Number.isFinite(Date.parse(start)) || Date.parse(start) > now)
    return false;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  return day.format(new Date(start)) === day.format(new Date(now));
}
export function preferredGame<
  T extends {
    scheduledStart?: string | null;
    timezone?: string | null;
    status: string;
  },
>(games: T[], now = Date.now()): T | undefined {
  const active = games.filter(
    (g) => !["completed", "closed", "deleted"].includes(g.status),
  );
  const current = active
    .filter((g) =>
      isCurrentGame(g.scheduledStart, g.timezone ?? "America/Toronto", now),
    )
    .sort(
      (a, b) => Date.parse(b.scheduledStart!) - Date.parse(a.scheduledStart!),
    );
  const future = active
    .filter((g) => g.scheduledStart && Date.parse(g.scheduledStart) > now)
    .sort(
      (a, b) => Date.parse(a.scheduledStart!) - Date.parse(b.scheduledStart!),
    );
  const past = games
    .filter((g) => g.status !== "deleted" && g.scheduledStart)
    .sort(
      (a, b) => Date.parse(b.scheduledStart!) - Date.parse(a.scheduledStart!),
    );
  return (
    current[0] ??
    future[0] ??
    past[0] ??
    active[0] ??
    games.find((g) => g.status !== "deleted")
  );
}
