import {
  programCompletionSchema,
  type ProgramCompletion,
  type ProgramPresentation,
} from "../program-presentation";

/** Local desired state survives renderer reloads; only the current document can
 * acknowledge its paint. A timeout never silently returns a live picture. */
export function createM4ProgramPresentation(
  accepts: (instance: string) => boolean,
  now = Date.now,
) {
  let value: ProgramPresentation = { generation: 0, mode: "live" };
  let painted: { generation: number; instance: string; at: number } | undefined;
  let ended = false;
  const waiters = new Set<() => void>();
  const changed = () => {
    for (const notify of waiters) notify();
  };
  return {
    snapshot: () => ({ ...value }),
    closing: () =>
      !ended && value.mode === "ended" && (value.deadlineAt ?? 0) > now(),
    acknowledge(instance: string, generation: number) {
      if (ended || !accepts(instance) || generation !== value.generation)
        return false;
      painted = { instance, generation, at: now() };
      changed();
      return true;
    },
    async set(
      mode: ProgramPresentation["mode"],
      completion?: ProgramCompletion,
      deadlineAt?: number,
    ) {
      if (ended) throw new Error("presentation_closed");
      if (mode === "ended") {
        completion = programCompletionSchema.parse(completion);
        if (!deadlineAt || deadlineAt <= now() || deadlineAt > now() + 30_000)
          throw new Error("closing_deadline_invalid");
      }
      const holdPicture = mode === "preparing-end" && value.mode === "hold";
      if (
        mode === "live" &&
        value.mode === "preparing-end" &&
        value.holdPicture
      )
        mode = "hold";
      if (mode === "preparing-end") deadlineAt = now() + 30_000;
      value = {
        generation: value.generation + 1,
        mode,
        ...(completion ? { completion } : {}),
        ...(deadlineAt ? { deadlineAt } : {}),
        ...(holdPicture ? { holdPicture } : {}),
      };
      painted = undefined;
      changed();
      const generation = value.generation;
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          if (ended || value.generation !== generation) {
            cleanup();
            reject(new Error("presentation_superseded"));
          } else if (
            painted?.generation === generation &&
            accepts(painted.instance)
          ) {
            cleanup();
            resolve();
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("presentation_paint_unconfirmed"));
        }, 5000);
        const cleanup = () => {
          clearTimeout(timer);
          waiters.delete(finish);
        };
        waiters.add(finish);
        finish();
      });
      return { ...value };
    },
    async dwell(ms = 5000) {
      if (
        !Number.isFinite(ms) ||
        ms < 0 ||
        ms > 10_000 ||
        !painted ||
        !accepts(painted.instance)
      )
        throw new Error("presentation_paint_unconfirmed");
      const generation = value.generation;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, painted!.at + ms - now())),
      );
      if (
        ended ||
        generation !== value.generation ||
        !painted ||
        !accepts(painted.instance)
      )
        throw new Error("presentation_superseded");
    },
    close() {
      ended = true;
      changed();
    },
  };
}
