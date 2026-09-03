export type ConnectionState =
  "idle" | "connecting" | "live" | "disconnected" | "permission-denied";

export type ConnectionEvent =
  "connect" | "published" | "disconnect" | "permission-denied";

export function nextConnectionState(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  if (event === "connect") return "connecting";
  if (event === "published") return "live";
  if (event === "permission-denied") return "permission-denied";
  if (event === "disconnect" && state !== "idle") return "disconnected";
  return state;
}
