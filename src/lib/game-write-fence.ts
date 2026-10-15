/** Reads straddling a write cannot replace its committed response. */
export class GameWriteFence {
  private epoch = 0;
  private pending = 0;

  read() {
    return this.pending ? undefined : this.epoch;
  }

  accepts(epoch: number | undefined) {
    return epoch !== undefined && !this.pending && epoch === this.epoch;
  }

  begin() {
    this.pending += 1;
    this.epoch += 1;
  }

  finish() {
    this.pending -= 1;
    this.epoch += 1;
  }
}
