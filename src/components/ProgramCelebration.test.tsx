import React from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { CelebrationCue } from "@/lib/player-celebrations";
const mocks = vi.hoisted(() => ({
  effect: undefined as (() => (() => void) | undefined) | undefined,
  state: null as CelebrationCue | null,
  setState: vi.fn(),
  ref: undefined as { current: string } | undefined,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => () => void) => {
    mocks.effect = effect;
  },
  useState: () => [mocks.state, mocks.setState],
  useRef: (current: string) => (mocks.ref ??= { current }),
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
  mocks.ref = undefined;
  vi.clearAllMocks();
  mocks.setState.mockImplementation((value) => {
    mocks.state = value;
  });
});
afterEach(() => vi.useRealTimers());
describe("program celebration once guard", () => {
  it("does not retain the previous game's clip when switching games", () => {
    ProgramCelebration({ gameId: "old", cue: cue("old"), nativeAudio: true });
    mocks.effect?.();
    const switched = ProgramCelebration({ gameId: "new", nativeAudio: true });
    expect(switched.props.cue).toBeNull();
    mocks.effect?.();
    expect(mocks.state).toBeNull();
  });
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
    ProgramCelebration({ gameId: "stop", nativeAudio: true, stopped: true });
    mocks.effect?.();
    expect(mocks.state).toBeNull();
    ProgramCelebration({ gameId: "expiry", cue: cue("expiry") });
    mocks.effect?.();
    await vi.advanceTimersByTimeAsync(8667);
    expect(mocks.state).toBeNull();
  });
  it("starts late native cues from the beginning and finishes after cloud expiry", () => {
    vi.setSystemTime(15000); // 2.5 seconds late, as observed in real Studio.
    ProgramCelebration({ gameId: "late", cue: cue("late"), nativeAudio: true });
    mocks.effect?.();
    const loaded = ProgramCelebration({
      gameId: "late",
      cue: cue("late"),
      nativeAudio: true,
    });
    expect(loaded.props.startWhenReady).toBe(true);
    expect(loaded.props.onStart()).toBe(true);
    vi.setSystemTime(19000); // The server now omits the expired request.
    ProgramCelebration({ gameId: "late", nativeAudio: true });
    mocks.effect?.();
    const playing = ProgramCelebration({ gameId: "late", nativeAudio: true });
    expect(playing.props.cue?.id).toBe("late");
    playing.props.onFinished();
    expect(mocks.state).toBeNull();
  });
  it("stops an already-started late cue when the server sends Stop", () => {
    ProgramCelebration({
      gameId: "late-stop",
      cue: cue("late-stop"),
      nativeAudio: true,
    });
    mocks.effect?.();
    const playing = ProgramCelebration({
      gameId: "late-stop",
      cue: cue("late-stop"),
      nativeAudio: true,
    });
    expect(playing.props.onStart()).toBe(true);
    const stopped = ProgramCelebration({
      gameId: "late-stop",
      nativeAudio: true,
      stopped: true,
    });
    expect(stopped.props.cue).toBeNull();
    mocks.effect?.();
    expect(mocks.state).toBeNull();
  });
});
