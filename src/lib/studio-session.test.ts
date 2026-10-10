import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveStudioNavigation,
  sessionGamePath,
  shouldGuardStudioNavigation,
  studioNavigationRequestSchema,
  studioSessionLabel,
  studioSessionSchema,
  stopStudioSession,
  type StudioSession,
} from "./studio-session";

const gameId = "11111111-1111-4111-8111-111111111111";
const otherGameId = "22222222-2222-4222-8222-222222222222";
const nonce = "33333333-3333-4333-8333-333333333333";
const otherNonce = "44444444-4444-4444-8444-444444444444";
const session: StudioSession = {
  gameId,
  title: "Club final",
  active: true,
  busy: false,
  presentation: "live",
  streaming: "armed",
  outputActive: true,
  live: true,
  canHoldStream: true,
};
const request = { gameId, nonce, href: "https://curlstreamer.test/dashboard" };

describe("Studio session status and navigation boundaries", () => {
  it("accepts an idle nullable session and rejects untrusted schema extensions", () => {
    expect(studioSessionSchema.safeParse(session).success).toBe(true);
    expect(
      studioSessionSchema.safeParse({ ...session, gameId: null, active: false })
        .success,
    ).toBe(true);
    for (const bad of [
      { ...session, gameId: "not-a-game" },
      { ...session, active: "true" },
      { ...session, presentation: "recording" },
      { ...session, title: "x".repeat(201) },
      { ...session, streaming: "x".repeat(41) },
      { ...session, privilegedToken: "unexpected" },
    ])
      expect(studioSessionSchema.safeParse(bad).success).toBe(false);
  });

  it("requires bounded native requests with valid game and nonce identities", () => {
    expect(studioNavigationRequestSchema.safeParse(request).success).toBe(true);
    for (const bad of [
      { ...request, nonce: "not-a-nonce" },
      { ...request, gameId: null },
      { ...request, href: "x".repeat(4097) },
      { ...request, decision: "continue" },
    ])
      expect(studioNavigationRequestSchema.safeParse(bad).success).toBe(false);
  });

  it.each([
    [{ active: false }, "Studio disconnected"],
    [{ presentation: "hold" }, "Broadcast paused"],
    [{ presentation: "preparing-end" }, "Broadcast ending"],
    [{ presentation: "ended" }, "Broadcast ending"],
    [{}, "Broadcast live"],
    [
      { outputActive: false, live: false, streaming: "starting" },
      "Broadcast connecting",
    ],
    [
      { outputActive: false, live: false, streaming: "stopping" },
      "Broadcast connecting",
    ],
    [{ live: false }, "Broadcast sending · Checking YouTube"],
    [
      { outputActive: false, live: false, streaming: "failed" },
      "Broadcast disconnected",
    ],
    [
      { outputActive: false, live: false, streaming: "paused" },
      "Broadcast disconnected",
    ],
    [
      { outputActive: false, live: false, streaming: "idle" },
      "Broadcast not started",
    ],
    [
      {
        presentation: "hold",
        outputActive: false,
        live: false,
        streaming: "idle",
      },
      "Broadcast not started",
    ],
  ] as [Partial<StudioSession>, string][])(
    "labels broadcast state %j as %s",
    (update, label) => {
      expect(studioSessionLabel({ ...session, ...update })).toBe(label);
    },
  );

  it("recognizes exact game routes and children without accepting sibling game prefixes", () => {
    for (const section of [
      "score",
      "games",
      "broadcast",
      "studio-m2",
      "studio-m4",
    ]) {
      expect(sessionGamePath(`/${section}/${gameId}`, gameId)).toBe(true);
      expect(sessionGamePath(`/${section}/${gameId}/edit`, gameId)).toBe(true);
      expect(sessionGamePath(`/${section}/${otherGameId}`, gameId)).toBe(false);
      expect(sessionGamePath(`/${section}/${gameId}-suffix`, gameId)).toBe(
        false,
      );
    }
    expect(sessionGamePath("/games/new", gameId)).toBe(false);
  });

  it("guards leaving only the running game's routes when broadcast output is at risk", () => {
    const target = new URL(request.href);
    const source = `/score/${gameId}`;
    expect(shouldGuardStudioNavigation(session, source, target)).toBe(true);
    expect(
      shouldGuardStudioNavigation(
        session,
        source,
        new URL(`https://curlstreamer.test/score/${otherGameId}`),
      ),
    ).toBe(true);
    expect(
      shouldGuardStudioNavigation(
        session,
        source,
        new URL(`https://curlstreamer.test/games/${gameId}/edit`),
      ),
    ).toBe(false);
    expect(shouldGuardStudioNavigation(session, "/dashboard", target)).toBe(
      false,
    );
    expect(
      shouldGuardStudioNavigation(session, `/score/${otherGameId}`, target),
    ).toBe(false);
    expect(shouldGuardStudioNavigation(null, source, target)).toBe(false);
    expect(
      shouldGuardStudioNavigation(
        { ...session, active: false },
        source,
        target,
      ),
    ).toBe(false);
    expect(
      shouldGuardStudioNavigation({ ...session, gameId: null }, source, target),
    ).toBe(false);
    expect(
      shouldGuardStudioNavigation(
        { ...session, outputActive: false, live: false, streaming: "idle" },
        source,
        target,
      ),
    ).toBe(false);
    expect(
      shouldGuardStudioNavigation(
        { ...session, outputActive: false, live: false, streaming: "starting" },
        source,
        target,
      ),
    ).toBe(true);
    expect(
      shouldGuardStudioNavigation(
        { ...session, outputActive: false, live: true },
        source,
        target,
      ),
    ).toBe(true);
    expect(
      shouldGuardStudioNavigation(
        { ...session, presentation: "hold" },
        source,
        target,
      ),
    ).toBe(true);
  });
});

describe("native navigation receipts", () => {
  let events: EventTarget;
  let sent: Record<string, unknown>[];
  let remove: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    events = new EventTarget();
    sent = [];
    remove = vi.fn(events.removeEventListener.bind(events));
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: remove,
      setTimeout,
      chrome: {
        webview: {
          postMessage: (message: Record<string, unknown>) => sent.push(message),
        },
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function receipt(detail: unknown) {
    events.dispatchEvent(
      new CustomEvent("studio-navigation-result", { detail }),
    );
  }

  it.each(["continue", "pause", "stay"] as const)(
    "posts only the correlated %s decision, never a destination",
    async (decision) => {
      const result = resolveStudioNavigation(request, decision);
      expect(sent).toEqual([
        { type: "studio-navigation-resolve", gameId, nonce, decision },
      ]);
      receipt({ gameId, nonce, ok: true });
      await expect(result).resolves.toBeUndefined();
      expect(remove).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("ignores wrong game, wrong nonce, malformed and extended receipts", async () => {
    const result = resolveStudioNavigation(request, "pause");
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    for (const detail of [
      { gameId: otherGameId, nonce, ok: true },
      { gameId, nonce: otherNonce, ok: true },
      { gameId, nonce, ok: "true" },
      { gameId, nonce, ok: true, href: request.href },
    ])
      receipt(detail);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    receipt({ gameId, nonce, ok: true, error: null });
    await expect(result).resolves.toBeUndefined();
  });

  it.each(["Native hold failed", null, ""])(
    "rejects native failure %j and removes pending listeners",
    async (error) => {
      const result = resolveStudioNavigation(request, "pause");
      const rejected = expect(result).rejects.toThrow(
        error || "Studio could not confirm leaving this game.",
      );
      receipt({ gameId, nonce, ok: false, error });
      await rejected;
      expect(remove).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("times out rather than treating absent confirmation as success", async () => {
    const result = resolveStudioNavigation(request, "continue");
    const rejected = expect(result).rejects.toThrow(
      "Studio did not confirm this action",
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports absent and throwing native bridges without leaving listeners attached", async () => {
    vi.stubGlobal("window", {});
    await expect(resolveStudioNavigation(request, "stay")).rejects.toThrow(
      "Windows Studio is unavailable.",
    );
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: remove,
      setTimeout,
      chrome: {
        webview: {
          postMessage() {
            throw new Error("bridge gone");
          },
        },
      },
    });
    await expect(resolveStudioNavigation(request, "continue")).rejects.toThrow(
      "Windows Studio is unavailable.",
    );
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases only after a valid receipt matching the requested session and stop nonce", async () => {
    const result = stopStudioSession(gameId);
    const stopNonce = sent[0].nonce;
    expect(sent[0]).toEqual({
      type: "studio-session-stop",
      gameId,
      nonce: expect.any(String),
    });
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    for (const detail of [
      { gameId: otherGameId, nonce: stopNonce, ok: true },
      { gameId, nonce: otherNonce, ok: true },
      { gameId, nonce: stopNonce, ok: true, destination: request.href },
    ])
      events.dispatchEvent(
        new CustomEvent("studio-session-stop-result", { detail }),
      );
    await Promise.resolve();
    expect(settled).toBe(false);
    events.dispatchEvent(
      new CustomEvent("studio-session-stop-result", {
        detail: { gameId, nonce: stopNonce, ok: true },
      }),
    );
    await expect(result).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains native refusal and timeout evidence while cleaning stop listeners", async () => {
    const refused = stopStudioSession(gameId);
    const rejected = expect(refused).rejects.toThrow("Output is still active");
    events.dispatchEvent(
      new CustomEvent("studio-session-stop-result", {
        detail: {
          gameId,
          nonce: sent[0].nonce,
          ok: false,
          error: "Output is still active",
        },
      }),
    );
    await rejected;
    const timeout = stopStudioSession(gameId);
    const expired = expect(timeout).rejects.toThrow(
      "did not confirm switching games",
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await expired;
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
