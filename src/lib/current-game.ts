export const CURRENT_GAME_KEY = "curlcast-current-game";

export type CurrentGameSelection = {
  id: string;
  title: string;
  scheduledLabel: string;
  access: "organizer" | "scorer";
};

export function readCurrentGame(storage: Pick<Storage, "getItem">) {
  try {
    const value = JSON.parse(storage.getItem(CURRENT_GAME_KEY) ?? "null");
    if (
      value &&
      typeof value.id === "string" &&
      typeof value.title === "string" &&
      typeof value.scheduledLabel === "string" &&
      (value.access === "organizer" || value.access === "scorer")
    )
      return value as CurrentGameSelection;
  } catch {
    // Ignore malformed device-local state.
  }
  return null;
}

export function selectCurrentGame(
  storage: Pick<Storage, "setItem">,
  selection: CurrentGameSelection,
) {
  storage.setItem(CURRENT_GAME_KEY, JSON.stringify(selection));
  globalThis.dispatchEvent?.(new Event("curlcast-current-game"));
}
