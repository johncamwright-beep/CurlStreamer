import { z } from "zod";
import {
  completedEndSchema,
  completedResultCorrectionSchema,
  type CompletedResultCorrection,
} from "@/lib/completed-result";

export const completedResultReplySchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completion: z.object({
    status: z.literal("completed"),
    eventName: z.string(),
    homeName: z.string(),
    awayName: z.string(),
    completedAt: z.string(),
    youtubeWatchUrl: z.string().nullable(),
    result: z.object({
      outcome: z.enum(["no_result", "tie", "home_win", "away_win"]),
      label: z.string(),
      totals: z
        .object({
          home: z.number().int().nonnegative(),
          away: z.number().int().nonnegative(),
        })
        .nullable(),
      ends: z.array(completedEndSchema).max(30),
    }),
  }),
});
export type EditableCompletedResult = z.infer<
  typeof completedResultReplySchema
>;
export type CompletedEnd = z.infer<typeof completedEndSchema>;

export function retainNewestCompletedResult(
  current: EditableCompletedResult | undefined,
  incoming: EditableCompletedResult,
): EditableCompletedResult {
  return current && current.revision > incoming.revision ? current : incoming;
}

export class CompletedResultRequestError extends Error {
  constructor(
    public kind: "conflict" | "authorization" | "invalid" | "uncertain",
    message: string,
  ) {
    super(message);
  }
}

/** A prepared correction is kept intact until its outcome is confirmed. */
export function prepareCompletedResultCorrection(
  revision: number,
  ends: CompletedEnd[],
  reason: string,
  requestId: string,
): CompletedResultCorrection {
  return completedResultCorrectionSchema.parse({
    requestId,
    expectedRevision: revision,
    ends,
    reason,
  });
}

export async function requestCompletedResult(
  gameId: string,
  correction?: CompletedResultCorrection,
): Promise<EditableCompletedResult> {
  let response: Response;
  try {
    response = await fetch(`/api/games/${gameId}/result`, {
      method: correction ? "PATCH" : "GET",
      cache: "no-store",
      ...(correction
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(correction),
          }
        : {}),
    });
  } catch {
    throw new CompletedResultRequestError(
      "uncertain",
      correction
        ? "The save could not be confirmed. Retry the same correction to check its outcome."
        : "The saved result could not be loaded. Try again.",
    );
  }
  if (!response.ok) {
    if (response.status === 409)
      throw new CompletedResultRequestError(
        "conflict",
        "The saved result changed or this game is no longer available. Reload the latest result before saving. Your draft has been kept.",
      );
    if (response.status === 403)
      throw new CompletedResultRequestError(
        "authorization",
        "Sign in as this team's owner or administrator to correct its result. Your draft has been kept.",
      );
    if (response.status === 400)
      throw new CompletedResultRequestError(
        "invalid",
        "Check the end scores and enter a reason for the correction. Your draft has been kept.",
      );
    throw new CompletedResultRequestError(
      "uncertain",
      correction
        ? "The save could not be confirmed. Retry the same correction when the service is available."
        : "Final result editing is temporarily unavailable. Try loading it again.",
    );
  }
  const parsed = completedResultReplySchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success)
    throw new CompletedResultRequestError(
      "uncertain",
      correction
        ? "The save response could not be confirmed. Retry the same correction."
        : "The saved result could not be read. Try loading it again.",
    );
  return parsed.data;
}
