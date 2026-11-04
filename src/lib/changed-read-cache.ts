/** Local, single-flight snapshots. Notifications never extend read freshness. */
export class ChangedReadCache<T> {
  #value?: { value: T; at: number; epoch: number };
  #pending?: Promise<T>;
  #epoch = 0;
  connected = false;
  constructor(
    private now = () => performance.now(),
    private maxAgeMs = 10_000,
  ) {}
  invalidate() {
    this.#epoch++;
  }
  clear() {
    this.invalidate();
    this.#value = undefined;
    this.connected = false;
  }
  read(load: () => Promise<T>): Promise<T> {
    const value = this.#value;
    if (
      this.connected &&
      value &&
      value.epoch === this.#epoch &&
      this.now() - value.at < this.maxAgeMs
    )
      return Promise.resolve(value.value);
    if (this.#pending) return this.#pending;
    const epoch = this.#epoch,
      started = this.now();
    const pending = load()
      .then((value) => {
        if (epoch === this.#epoch) this.#value = { value, at: started, epoch };
        return value;
      })
      .finally(() => {
        if (this.#pending === pending) this.#pending = undefined;
      });
    this.#pending = pending;
    return pending;
  }
}
