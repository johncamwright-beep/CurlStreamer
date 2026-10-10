type OwnerStorage = Pick<Storage, "getItem" | "setItem">;

export function cameraPageOwnerKey(gameId: string, cameraRole: string): string {
  return `curlstreamer:camera-page-owner:${encodeURIComponent(gameId)}:${encodeURIComponent(cameraRole)}`;
}

/** Local page coordination only; this marker grants no camera authority. */
export class CameraPageOwner {
  private readonly ownerId: string;
  private readonly target: EventTarget | undefined;
  private active = false;
  private closed = false;

  constructor(
    private readonly options: {
      key: string;
      storage?: OwnerStorage;
      target?: EventTarget;
      ownerId?: string;
      onLost(): void;
    },
  ) {
    this.ownerId = options.ownerId ?? crypto.randomUUID();
    this.target =
      options.target ?? (typeof window === "undefined" ? undefined : window);
    this.target?.addEventListener("storage", this.onStorage);
  }

  private storage(): OwnerStorage {
    return this.options.storage ?? window.localStorage;
  }

  private readonly onStorage = (event: Event) => {
    const change = event as StorageEvent;
    if (change.key !== null && change.key !== this.options.key) return;
    // Read the current marker: an older queued event may follow a newer claim.
    this.held();
  };

  private lose(): void {
    if (!this.active) return;
    this.active = false;
    try {
      this.options.onLost();
    } catch {
      /* Ownership remains lost even if the observer throws. */
    }
  }

  /** Call only for a deliberate user Connect; retries must use held(). */
  acquire(): boolean {
    if (this.closed) return false;
    try {
      const storage = this.storage();
      storage.setItem(this.options.key, this.ownerId);
      if (storage.getItem(this.options.key) !== this.ownerId) {
        this.lose();
        return false;
      }
      this.active = true;
      return true;
    } catch {
      this.lose();
      return false;
    }
  }

  /** Recheck synchronously before each retry or request, including same-tab work. */
  held(): boolean {
    if (this.closed || !this.active) return false;
    try {
      if (this.storage().getItem(this.options.key) === this.ownerId)
        return true;
    } catch {
      /* Unavailable storage cannot establish current ownership. */
    }
    this.lose();
    return false;
  }

  release(): void {
    this.active = false;
    // Keep an inert marker. localStorage has no atomic compare-and-remove:
    // deleting after a read could erase another tab's intervening claim.
    // held() also requires local active state; deliberate Connect overwrites it.
  }

  close(): void {
    if (this.closed) return;
    this.release();
    this.closed = true;
    this.target?.removeEventListener("storage", this.onStorage);
  }
}
