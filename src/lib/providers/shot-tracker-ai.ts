import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  REPORT_INSTRUCTIONS,
  audienceInstructions,
  narrativeSchema,
  validateNarrative,
  type ReportInput,
  type ReportAudience,
  type Narrative,
} from "@/lib/curlcoach/reports";

export function reportAIConfig() {
  const model = process.env.SHOT_TRACKER_AI_MODEL?.trim();
  return process.env.SHOT_TRACKER_AI_ENABLED === "true" &&
    process.env.OPENAI_API_KEY &&
    model
    ? { model }
    : null;
}
/** Fixed destination and server-owned instructions; no user prompts or raw private notes. */
export async function generateShotTrackerNarrative(
  input: ReportInput,
  audience: ReportAudience,
  forbiddenNames: string[],
  signal?: AbortSignal,
): Promise<Narrative> {
  const requestSignal = signal ?? AbortSignal.timeout(45_000);
  try {
    return await generateOnce(input, audience, forbiddenNames, requestSignal);
  } catch (error) {
    // Retry validation failures once, never billing, transport, or aborted requests.
    // Only an allowlisted category is sent back; rejected prose is never reused.
    if (
      requestSignal.aborted ||
      !(error instanceof Error) ||
      ![
        "Unknown evidence",
        "Individual commentary in team report",
        "Invalid report prose",
        "Unsupported report interpretation",
      ].includes(error.message)
    )
      throw error;
    return generateOnce(
      input,
      audience,
      forbiddenNames,
      requestSignal,
      `A previous draft failed validation: ${error.message}. Write a fresh, shorter draft that strictly follows all audience and evidence rules.`,
    );
  }
}

async function generateOnce(
  input: ReportInput,
  audience: ReportAudience,
  forbiddenNames: string[],
  signal: AbortSignal,
  correction = "",
): Promise<Narrative> {
  const config = reportAIConfig();
  if (!config) throw new Error("AI reports are not configured");
  if (!input.evidence.length) throw new Error("No report evidence");
  const finding = narrativeSchema.shape.summary.extend({
    text: narrativeSchema.shape.summary.shape.text.regex(/^[^0-9<>]*$/),
    evidence: z
      .array(z.enum(input.evidence.map((e) => e.id) as [string, ...string[]]))
      .min(1)
      .max(6),
  });
  const baseSchema = narrativeSchema.omit({ games: true }).extend({
    summary: finding,
    strengths: z.array(finding).min(1).max(2),
    priorities: z.array(finding).min(1).max(2),
    practice: z.array(finding).min(1).max(2),
    review: z.array(finding).min(1).max(2),
  });
  const gameKeys = input.games?.map((g) => g.key) ?? [];
  const outputSchema = gameKeys.length
    ? baseSchema.extend({
        games: z
          .array(
            finding
              .extend({ key: z.enum(gameKeys as [string, ...string[]]) })
              .strict(),
          )
          .length(gameKeys.length),
      })
    : baseSchema;
  const response = await requestReport({
    method: "POST",
    cache: "no-store",
    signal,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      max_output_tokens: Math.min(12000, 3200 + 240 * gameKeys.length),
      instructions:
        REPORT_INSTRUCTIONS +
        "\n" +
        audienceInstructions(audience) +
        (gameKeys.length
          ? "\nAdd one game paragraph for every supplied game key, in schedule order. Each paragraph should be thirty-five to fifty-five words, at most sixty-five. Explain the clearest supported strength, a useful area to work on and one practical adjustment to rehearse. Use only evidence IDs starting with that game's key followed by a hyphen. Do not transfer event-wide or another game's patterns to this game. If no measurements are available, say the game cannot be assessed; absence of records does not mean the athlete did not play. Sparse categories are tentative; do not diagnose delivery or claim that performance caused the game result. The main event overview should synthesize recurring themes instead of repeating these paragraphs. Shooting percentages and execution/miss-label distributions have different denominators; do not equate them. Be specific about the recorded category rather than generic praise, without reciting numbers."
          : "") +
        "\n" +
        correction,
      input: JSON.stringify({
        evidence: input.evidence,
        limitations: input.limitations,
        ...(gameKeys.length ? { gameKeys } : {}),
      }),
      text: {
        format: {
          type: "json_schema",
          name: "shot_tracker_report",
          strict: true,
          // Reuse the finding/evidence definitions instead of repeating every
          // game evidence ID in each section of the request.
          schema: z.toJSONSchema(outputSchema, { reused: "ref" }),
        },
      },
    }),
  });
  // Never return/log upstream bodies, headers, account identifiers or credentials.
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = z
      .enum([
        "invalid_api_key",
        "insufficient_quota",
        "credit_balance_exhausted",
        "organization_spend_limit_exceeded",
        "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded",
        "slow_down",
        "rate_limit_exceeded",
        "model_not_found",
        "invalid_json_schema",
        "unsupported_parameter",
      ])
      .safeParse(body?.error?.code);
    console.error("Shot Tracker AI request failed", {
      status: response.status,
      code: code.success ? code.data : "unavailable",
    });
    throw new Error("Report provider unavailable");
  }
  const data = (await response.json()) as {
    status?: string;
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  };
  if (data.status !== "completed")
    throw new Error("Report generation incomplete");
  const content =
    data.output
      ?.filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? []) ?? [];
  if (content.some((c) => c.type === "refusal"))
    throw new Error("Report generation unavailable");
  const text = content
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
  return validateNarrative(JSON.parse(text), input, audience, forbiddenNames);
}

async function requestReport(init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    const response = await fetch("https://api.openai.com/v1/responses", init);
    if (response.status !== 429 || attempt >= 2) return response;
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    // Quota/billing errors also use 429, but waiting cannot repair them.
    if (!["rate_limit_exceeded", "slow_down"].includes(body?.error?.code))
      return response;
    const hint = response.headers.get("retry-after");
    const seconds = hint === null ? NaN : Number(hint);
    const serverWait =
      Number.isFinite(seconds) && seconds >= 0
        ? seconds * 1000
        : hint
          ? Date.parse(hint) - Date.now()
          : NaN;
    const wait =
      Number.isFinite(serverWait) && serverWait >= 0
        ? serverWait
        : 5000 * 2 ** attempt;
    // Never retry sooner than the provider asks. The packet deadline also
    // cancels both the wait and subsequent requests.
    if (wait > 30_000) return response;
    await delay(wait + Math.floor(Math.random() * 250), undefined, {
      signal: init.signal ?? undefined,
    });
  }
}
