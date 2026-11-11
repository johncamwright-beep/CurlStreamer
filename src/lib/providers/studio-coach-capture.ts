import { setTimeout as delay } from "node:timers/promises";
import { coachMp4Duration } from "./coach-mp4-duration";
import type { startM4StudioRecorder } from "./m4-studio-recorder";

export type CoachRecorder = NonNullable<
  Awaited<ReturnType<typeof startM4StudioRecorder>>["coach"]
>;

const capturing = new WeakSet<CoachRecorder>();

/** Both review entry points use the same native snapshot slot. */
export async function captureCoachClip(
  coach: CoachRecorder,
  isCurrent: () => boolean,
) {
  if (!isCurrent() || capturing.has(coach))
    throw Error("Coach capture unavailable");
  capturing.add(coach);
  try {
    const capturedAt = new Date().toISOString();
    await coach.capture();
    const deadline = performance.now() + 16_000;
    while (isCurrent() && performance.now() < deadline) {
      const status = await coach.status();
      if (!isCurrent() || status.state === 7) break;
      if (status.state === 3) {
        const bytes = await coach.snapshot();
        if (!isCurrent()) break;
        const duration = coachMp4Duration(bytes);
        return {
          bytes,
          capturedAt,
          duration,
          minimum: Math.max(0, duration - 120),
        };
      }
      await delay(200);
    }
    throw Error("Coach capture unavailable");
  } finally {
    capturing.delete(coach);
  }
}
