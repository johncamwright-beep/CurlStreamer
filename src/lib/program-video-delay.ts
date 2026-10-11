/** Compressed frames stay bounded even when a camera produces large JPEGs.
 * Preserve the oldest and newest frame, thinning the most densely sampled
 * interior first so capacity pressure does not continually postpone playout. */
export class ProgramVideoDelayQueue {
  private frames: { blob: Blob; receivedAt: number }[] = [];
  private bytes = 0;

  constructor(
    readonly delayMs: number,
    private readonly maxFrames = 192,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {}

  get length() {
    return this.frames.length;
  }

  get retainedBytes() {
    return this.bytes;
  }

  enqueue(blob: Blob, receivedAt: number) {
    if (!blob.size || blob.size > this.maxBytes || !Number.isFinite(receivedAt))
      return;
    const previous = this.frames.at(-1);
    if (previous && receivedAt < previous.receivedAt) return;
    this.frames.push({ blob, receivedAt });
    this.bytes += blob.size;
    while (this.frames.length > this.maxFrames || this.bytes > this.maxBytes) {
      let remove = this.frames.length - 1;
      let smallestSpan = Infinity;
      for (let i = 1; i < this.frames.length - 1; i++) {
        const span =
          this.frames[i + 1].receivedAt - this.frames[i - 1].receivedAt;
        if (span < smallestSpan) {
          smallestSpan = span;
          remove = i;
        }
      }
      this.bytes -= this.frames.splice(remove, 1)[0].blob.size;
    }
  }

  /** Only the newest eligible frame is decoded; missed paints never replay a
   * burst of stale frames, and younger frames never bypass the selected delay. */
  takeDue(now: number): Blob | undefined {
    let due: Blob | undefined;
    while (
      this.frames.length &&
      this.frames[0].receivedAt + this.delayMs <= now
    ) {
      const frame = this.frames.shift()!;
      this.bytes -= frame.blob.size;
      due = frame.blob;
    }
    return due;
  }

  clear() {
    this.frames = [];
    this.bytes = 0;
  }
}
