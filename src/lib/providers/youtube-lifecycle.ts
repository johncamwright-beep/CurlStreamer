/** Decisions from provider state; never turn a failed status read into a stop. */
export function youtubeLifecycle(broadcast: string, stream: string) {
  switch (broadcast) {
    case "complete":
      return "ended";
    case "revoked":
      return "removed";
    case "live":
      return stream === "active" ? "live" : "reconnecting";
    case "liveStarting":
    case "testStarting":
      return "starting";
    case "created":
      return "setup-required";
    case "ready":
    case "testing":
      return stream === "active"
        ? "go-live"
        : stream === "error"
          ? "stream-error"
          : "waiting-video";
    default:
      return "unknown";
  }
}
