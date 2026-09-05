export type RefreshLifecycle = "active" | "completed" | "closed" | "deleted";

export type RefreshTicket = Readonly<{
  generation: number;
  sequence: number;
}>;

const isTerminal = (
  lifecycle: RefreshLifecycle | undefined,
): lifecycle is Exclude<RefreshLifecycle, "active"> =>
  lifecycle !== undefined && lifecycle !== "active";

export class GameRefreshGate {
  private generation = 0;
  private issued = 0;
  private applied = 0;
  private terminal: Exclude<RefreshLifecycle, "active"> | undefined;

  reset() {
    this.generation += 1;
    this.issued = 0;
    this.applied = 0;
    this.terminal = undefined;
  }

  start(): RefreshTicket {
    return { generation: this.generation, sequence: ++this.issued };
  }

  accept(ticket: RefreshTicket, lifecycle?: RefreshLifecycle) {
    if (ticket.generation !== this.generation) return false;

    // Deletion is the only valid transition after another terminal lifecycle.
    // Once deleted, no response can restore or replace the game.
    if (this.terminal) {
      if (this.terminal !== "deleted" && lifecycle === "deleted") {
        this.terminal = "deleted";
        this.applied = Math.max(this.applied, ticket.sequence);
        return true;
      }
      return false;
    }

    // Terminal lifecycle is monotonic and authoritative, so accept it even if
    // a newer active response happened to finish first.
    if (isTerminal(lifecycle)) {
      this.terminal = lifecycle;
      this.applied = Math.max(this.applied, ticket.sequence);
      return true;
    }

    if (ticket.sequence < this.applied) return false;
    this.applied = ticket.sequence;
    return true;
  }
}
