import { describe, expect, it } from "vitest";
import { GameRefreshGate } from "./game-refresh-gate";

describe("GameRefreshGate", () => {
  it("applies a slow response while a newer request is still in flight", () => {
    const gate = new GameRefreshGate();
    const slow = gate.start();
    gate.start();

    expect(gate.accept(slow, "active")).toBe(true);
  });

  it("keeps terminal lifecycle sticky against late active responses", () => {
    const gate = new GameRefreshGate();
    const terminal = gate.start();
    const active = gate.start();

    expect(gate.accept(terminal, "completed")).toBe(true);
    expect(gate.accept(active, "active")).toBe(false);
  });

  it("allows terminal lifecycle to advance to deleted but never downgrade", () => {
    const gate = new GameRefreshGate();
    const completed = gate.start();
    const deleted = gate.start();
    const lateCompleted = gate.start();

    expect(gate.accept(completed, "completed")).toBe(true);
    expect(gate.accept(deleted, "deleted")).toBe(true);
    expect(gate.accept(lateCompleted, "completed")).toBe(false);
  });

  it("invalidates old requests when reset for a different game", () => {
    const oldGame = gateTicket();
    const { gate, ticket } = oldGame;
    gate.reset();
    const newGame = gate.start();

    expect(gate.accept(ticket, "completed")).toBe(false);
    expect(gate.accept(newGame, "active")).toBe(true);
  });
});

function gateTicket() {
  const gate = new GameRefreshGate();
  return { gate, ticket: gate.start() };
}
