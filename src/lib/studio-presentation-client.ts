import { z } from "zod";
import { programPresentationSchema } from "./program-presentation";

const closingPreparationSchema = z.object({
  sessionId: z.string().uuid(),
  generation: z.number().int().positive(),
  intentId: z.string().uuid(),
  capability: z.literal("final-card-v1"),
});
const receiptSchema = z.object({
  gameId: z.string().uuid(),
  nonce: z.string().uuid(),
  ok: z.boolean(),
  presentation: programPresentationSchema.nullable().optional(),
  closing: closingPreparationSchema.nullable().optional(),
  error: z.string().max(300).nullable().optional(),
});

export type StudioClosingPreparation = z.infer<typeof closingPreparationSchema>;

/** Receipts are correlated to this request and game. They are UI evidence only;
 * the completion endpoint independently validates the desktop/output authority. */
export function requestStudioPresentation(
  gameId: string,
  action: "prepare" | "show" | "cancel" | "finish" | "hold" | "resume",
  payload: Record<string, unknown> = {},
  timeoutMs = 12000,
): Promise<z.infer<typeof receiptSchema>> {
  const bridge = (
    window as Window & {
      chrome?: { webview?: { postMessage(message: unknown): void } };
    }
  ).chrome?.webview;
  if (!bridge)
    return Promise.reject(new Error("Windows Studio is unavailable."));
  const nonce = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      window.removeEventListener("studio-presentation-result", receive);
    };
    const receive = (event: Event) => {
      const parsed = receiptSchema.safeParse((event as CustomEvent).detail);
      if (
        !parsed.success ||
        parsed.data.gameId !== gameId ||
        parsed.data.nonce !== nonce
      )
        return;
      clean();
      if (parsed.data.ok) resolve(parsed.data);
      else
        reject(
          new Error(
            parsed.data.error || "Studio could not prepare the broadcast card.",
          ),
        );
    };
    const timer = window.setTimeout(() => {
      clean();
      reject(new Error("Studio did not confirm the broadcast card in time."));
    }, timeoutMs);
    window.addEventListener("studio-presentation-result", receive);
    try {
      bridge.postMessage({
        ...payload,
        type:
          action === "hold" || action === "resume"
            ? `studio-youtube-${action}`
            : `studio-ending-${action}`,
        gameId,
        nonce,
      });
    } catch {
      clean();
      reject(new Error("Windows Studio is unavailable."));
    }
  });
}
