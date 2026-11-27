import { z } from "zod";
import type { ConnectionDiagnostic } from "./connection-diagnostics";

export const m4RendererHeartbeatSchema = z
  .object({
    action: z.literal("renderer-heartbeat"),
    instance: z.uuid(),
    frames: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    visibility: z.enum(["visible", "hidden"]),
  })
  .strict();

/** Document epochs fence delayed observations from a replaced renderer. */
export function createM4RendererHealth(now = () => performance.now()) {
  let instance = "";
  let frames = 0;
  let startedAt = now();
  let observedAt: number | undefined;
  let advancedAt: number | undefined;
  let visibility: "visible" | "hidden" = "hidden";
  let active = true;
  return {
    accepts(value: string) {
      return active && value === instance;
    },
    begin(value: string) {
      instance = value;
      frames = 0;
      startedAt = now();
      observedAt = advancedAt = undefined;
      visibility = "hidden";
    },
    observe(input: z.infer<typeof m4RendererHeartbeatSchema>) {
      if (!active || input.instance !== instance || input.frames < frames)
        return false;
      observedAt = now();
      if (input.frames > frames) advancedAt = observedAt;
      frames = input.frames;
      visibility = input.visibility;
      return true;
    },
    snapshot() {
      const time = now();
      return {
        active,
        startedMs: Math.max(0, time - startedAt),
        heartbeatAgeMs:
          observedAt === undefined ? null : Math.max(0, time - observedAt),
        frameAgeMs:
          advancedAt === undefined ? null : Math.max(0, time - advancedAt),
        frames,
        visibility,
      };
    },
    close() {
      active = false;
    },
  };
}

export type M4RendererHealth = ReturnType<
  ReturnType<typeof createM4RendererHealth>["snapshot"]
>;
export type M4ProgramPaintHealth = {
  rawSequence: number;
  paintChanges: number;
  ageMs: number;
  active: boolean;
};

/** A refresh changes only the browser source, never recorder/output ownership. */
export function startM4ProgramWatchdog(options: {
  renderer: () => M4RendererHealth;
  paint: () => Promise<M4ProgramPaintHealth>;
  refresh: () => Promise<boolean>;
  diagnostic?: ConnectionDiagnostic;
  now?: () => number;
}) {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let phase: "starting" | "healthy" | "recovering" | "failed" = "starting";
  let attempts: number[] = [];
  let refreshAt = Number.NEGATIVE_INFINITY;
  let lastReason: string | undefined;
  const log = (
    code:
      | "renderer_stale"
      | "paint_stale"
      | "refresh_requested"
      | "refresh_failed"
      | "recovery_exhausted"
      | "recovered",
  ) => {
    try {
      options.diagnostic?.({
        layer: "program",
        code,
        attempt: attempts.length,
      });
    } catch {
      /* best effort */
    }
  };
  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const renderer = options.renderer();
      if (!renderer.active) return;
      const paint = await options.paint().catch(() => undefined);
      if (stopped || !options.renderer().active) return;
      const age = now() - startedAt;
      const reason =
        renderer.heartbeatAgeMs === null ||
        renderer.heartbeatAgeMs > 8000 ||
        renderer.frameAgeMs === null ||
        renderer.frameAgeMs > 10000
          ? "renderer_stale"
          : !paint ||
              !paint.active ||
              !paint.rawSequence ||
              !paint.paintChanges ||
              paint.ageMs > 10000
            ? "paint_stale"
            : undefined;
      if (!reason) {
        if (phase === "recovering" || phase === "failed") log("recovered");
        phase = "healthy";
        lastReason = undefined;
        return;
      }
      // Slow startup and a just-accepted source reload receive their own grace.
      if (
        age < 20000 ||
        renderer.startedMs < 15000 ||
        now() - refreshAt < 15000
      )
        return;
      if (lastReason !== reason) {
        log(reason);
        lastReason = reason;
      }
      attempts = attempts.filter((at) => now() - at < 600000);
      if (attempts.length >= 3) {
        if (phase !== "failed") log("recovery_exhausted");
        phase = "failed";
        return;
      }
      phase = "recovering";
      refreshAt = now();
      attempts.push(refreshAt);
      log("refresh_requested");
      const accepted = await options.refresh().catch(() => false);
      if (!stopped && !accepted) log("refresh_failed");
      // Acceptance is not recovery; new heartbeat and paint proof decide.
    } finally {
      inFlight = false;
      if (!stopped) {
        timer = setTimeout(() => void tick(), 1500);
        timer.unref?.();
      }
    }
  };
  timer = setTimeout(() => void tick(), 1500);
  timer.unref?.();
  return {
    snapshot: () => ({ phase, attempts: attempts.length }),
    close: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
