export const dashboardCompletionEvent = "curlcast:game-completed";
export const dashboardCompletionChannel = "curlcast-dashboard";
export const dashboardCompletionStorage = "curlcast-dashboard-invalidation";

export function isCompletionNotice(value: unknown): value is {
  type: "game-completed";
  gameId: string;
} {
  if (!value || typeof value !== "object") return false;
  const notice = value as Record<string, unknown>;
  return (
    notice.type === "game-completed" &&
    typeof notice.gameId === "string" &&
    notice.gameId.length > 0 &&
    notice.gameId.length <= 128
  );
}

/** A notice requests a fresh authorized server projection; it contains no counts. */
export function announceGameCompletion(gameId: string) {
  const notice = { type: "game-completed", gameId };
  window.dispatchEvent(
    new CustomEvent(dashboardCompletionEvent, { detail: notice }),
  );
  try {
    const channel = new BroadcastChannel(dashboardCompletionChannel);
    try {
      channel.postMessage(notice);
    } finally {
      channel.close();
    }
  } catch {
    // Storage and return-to-page refresh also work without BroadcastChannel.
  }
  try {
    localStorage.setItem(
      dashboardCompletionStorage,
      JSON.stringify({ ...notice, nonce: `${Date.now()}-${Math.random()}` }),
    );
  } catch {
    // A restricted browser must still show the committed completion result.
  }
}

/** Event-driven refreshes, coalesced without polling hidden or pending pages. */
export class DashboardRefreshQueue {
  private dirty = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastRefresh = -Infinity;

  constructor(
    private refresh: () => void,
    private ready: () => boolean,
  ) {}

  request() {
    if (this.stopped) return;
    this.dirty = true;
    this.resume();
  }

  resume() {
    if (this.stopped || !this.dirty || this.timer || !this.ready()) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (!this.ready()) return;
        this.dirty = false;
        this.lastRefresh = Date.now();
        this.refresh();
      },
      Math.max(200, 1000 - (Date.now() - this.lastRefresh)),
    );
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
