import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestStudioPresentation } from "./studio-presentation-client";

const gameId = "11111111-1111-4111-8111-111111111111";
let events: EventTarget;
let sent: Record<string, unknown>[];
beforeEach(() => {
  vi.useFakeTimers();
  events = new EventTarget();
  sent = [];
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    setTimeout,
    chrome: {
      webview: { postMessage: (v: Record<string, unknown>) => sent.push(v) },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function receipt(detail: unknown) {
  events.dispatchEvent(
    new CustomEvent("studio-presentation-result", { detail }),
  );
}
describe("Studio presentation receipts", () => {
  it("requires the matching game and request nonce before confirming a card", async () => {
    const result = requestStudioPresentation(gameId, "show", {
      gameId: "wrong",
      nonce: "wrong",
      type: "wrong",
    });
    expect(sent[0]).toMatchObject({ gameId, type: "studio-ending-show" });
    const nonce = sent[0].nonce;
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    receipt({
      gameId: "22222222-2222-4222-8222-222222222222",
      nonce,
      ok: true,
    });
    receipt({
      gameId,
      nonce: "33333333-3333-4333-8333-333333333333",
      ok: true,
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    receipt({ gameId, nonce, ok: true, error: null });
    await expect(result).resolves.toMatchObject({ gameId, nonce, ok: true });
  });
  it("rejects an unconfirmed renderer or timed out request", async () => {
    const failed = requestStudioPresentation(gameId, "prepare");
    const rejected = expect(failed).rejects.toThrow("Renderer unavailable");
    receipt({
      gameId,
      nonce: sent[0].nonce,
      ok: false,
      error: "Renderer unavailable",
    });
    await rejected;
    const timeout = requestStudioPresentation(gameId, "finish", {}, 1000);
    const expired = expect(timeout).rejects.toThrow("in time");
    await vi.advanceTimersByTimeAsync(1000);
    await expired;
  });
});
