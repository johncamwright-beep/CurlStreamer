import "server-only";
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
  const outputSchema = narrativeSchema.extend({
    summary: finding,
    strengths: z.array(finding).min(1).max(2),
    priorities: z.array(finding).min(1).max(2),
    practice: z.array(finding).min(1).max(2),
    review: z.array(finding).min(1).max(2),
  });
  const response = await fetch("https://api.openai.com/v1/responses", {
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
      max_output_tokens: 3200,
      instructions:
        REPORT_INSTRUCTIONS +
        "\n" +
        audienceInstructions(audience) +
        "\n" +
        correction,
      input: JSON.stringify({
        evidence: input.evidence,
        limitations: input.limitations,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "shot_tracker_report",
          strict: true,
          schema: z.toJSONSchema(outputSchema),
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
