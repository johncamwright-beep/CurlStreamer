import React from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { CelebrationCue } from "@/lib/player-celebrations";
const mocks = vi.hoisted(() => ({
  effect: undefined as (() => (() => void) | undefined) | undefined,
  state: null as CelebrationCue | null,
  setState: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => () => void) => {
    mocks.effect = effect;
  },
  useState: () => [mocks.state, mocks.setState],
  useCallback: (callback: unknown) => callback,
}));
vi.mock("./PlayerCelebration", () => ({ PlayerCelebration: () => null }));
import { ProgramCelebration } from "./ProgramCelebration";
const cue = (id: string): CelebrationCue => ({
  id,
  templateId: "lightsaber",
  playerId: "roster-1",
  playerName: "Sam",
  headshotUrl: "/celebrations/headshot/local",
  startedAt: 12500,
  expiresAt: 18667,
  volume: 0.6,
  muted: false,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  mocks.state = null;
  vi.clearAllMocks();
  mocks.setState.mockImplementation((value) => {
    mocks.state = value;
  });
});
afterEach(() => vi.useRealTimers());
describe("program celebration once guard", () => {
  it("mounts the future clip early for atomic head/video preload and keeps previews silent", () => {
    ProgramCelebration({ gameId: "preview", cue: cue("preview") });
    mocks.effect?.();
    const element = ProgramCelebration({
      gameId: "preview",
      cue: cue("preview"),
    });
    expect(element.props.cue).toEqual(cue("preview"));
    expect(element.props.nativeAudio).toBe(false);
    expect(element.props.onStart()).toBe(true);
  });
  it("marks native cues consumed only at actual start and suppresses racing starts/remounts", () => {
    ProgramCelebration({
      gameId: "native",
      cue: cue("once"),
      nativeAudio: true,
    });
    mocks.effect?.();
    const preload = ProgramCelebration({
      gameId: "native",
      cue: cue("once"),
      nativeAudio: true,
    });
    expect(preload.props.cue).toEqual(cue("once"));
    expect(preload.props.onStart()).toBe(true);
    expect(preload.props.onStart()).toBe(false);
    ProgramCelebration({
      gameId: "native",
      cue: cue("once"),
      nativeAudio: true,
    });
    mocks.effect?.();
    expect(mocks.state).toBeNull();
  });
  it("drops expired and missing-head commands instead of exposing the base face", () => {
    ProgramCelebration({
      gameId: "missing",
      cue: { ...cue("missing"), headshotUrl: undefined },
      nativeAudio: true,
    });
    mocks.effect?.();
    expect(mocks.state).toBeNull();
    vi.setSystemTime(20000);
    ProgramCelebration({
      gameId: "expired",
      cue: cue("expired"),
      nativeAudio: true,
    });
    mocks.effect?.();
    expect(mocks.state).toBeNull();
  });
  it("clears a queued cue immediately on Stop and at its bounded expiry", async () => {
    ProgramCelebration({ gameId: "stop", cue: cue("stop"), nativeAudio: true });
    mocks.effect?.();
    ProgramCelebration({ gameId: "stop", nativeAudio: true });
    mocks.effect?.();
    expect(mocks.state).toBeNull();
    ProgramCelebration({ gameId: "expiry", cue: cue("expiry") });
    mocks.effect?.();
    await vi.advanceTimersByTimeAsync(8667);
    expect(mocks.state).toBeNull();
  });
});
