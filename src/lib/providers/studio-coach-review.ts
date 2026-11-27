import { randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { startCoachLocalProof } from "./coach-local-proof";
import { captureCoachClip, type CoachRecorder } from "./studio-coach-capture";

/** Opt-in Studio integration. Local selections are durable; this does not write production shots. */
export async function startStudioCoachReview(options: {
  host: string;
  port?: number;
  gameId: string;
  directory: string;
  htmlPath?: string;
  appOrigin?: string;
  coach: CoachRecorder;
}) {
  const gameId = z.uuid().parse(options.gameId);
  const appOrigin = options.appOrigin
    ? z
        .url()
        .refine(
          (value) =>
            new URL(value).origin === value &&
            new URL(value).protocol === "https:",
        )
        .parse(options.appOrigin)
    : undefined;
  const directory = join(options.directory, `coach-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const code = String(randomInt(100000, 1000000));
  let closed = false;
  const server = await startCoachLocalProof({
    host: options.host,
    port: options.port ?? 0,
    lifetimeMs: 12 * 60 * 60 * 1000,
    ...(appOrigin ? { bridge: { appOrigin, gameId } } : {}),
    code,
    duration: 120,
    htmlPath: options.htmlPath,
    capture: async () => {
      const { bytes, duration, capturedAt } = await captureCoachClip(
        options.coach,
        () => !closed,
      );
      const video = join(directory, `${randomUUID()}.mp4`);
      await writeFile(video, bytes, { flag: "wx" });
      return { video, duration, capturedAt };
    },
    saveSelection: async (selection, clip) => {
      if (closed || !clip) throw Error("Game review closed");
      const id = randomUUID();
      const selectedAt = new Date(
        Date.parse(clip.capturedAt) -
          (clip.duration - selection.startSeconds) * 1000,
      ).toISOString();
      await writeFile(
        join(directory, `${id}.json`),
        JSON.stringify({
          version: 1,
          id,
          gameId,
          ...selection,
          selectedAt,
          capturedAt: clip.capturedAt,
          timingEstimated: true,
          // Player assignment is made by the authenticated Shot Tracker handoff.
          status: "pending-shot-tracker-handoff",
        }),
        { flag: "wx" },
      );
      if (appOrigin) {
        const review = {
          version: 1,
          id,
          gameId,
          audience: selection.audience,
          notes: selection.notes,
          selectedAt,
          capturedAt: clip.capturedAt,
          timingEstimated: true,
        };
        return {
          handoffUrl: `${appOrigin}/shot-tracker/review-import#${encodeURIComponent(JSON.stringify(review))}`,
        };
      }
    },
  });
  return {
    address: server.address,
    code,
    close() {
      closed = true;
      server.close();
    },
  };
}
