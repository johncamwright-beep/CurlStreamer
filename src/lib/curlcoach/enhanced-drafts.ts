import { z } from "zod";
import { supplementSchema, type Supplement } from "./enhanced-catalog";
export type EnhancedDraft = { value: Supplement; revision: number };
// Drafts may contain incomplete cross-field assessments; committed saves may not.
const draftSchema = z
  .object({
    value: z.object(supplementSchema.shape).strict(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export function readEnhancedDraft(
  storage: Pick<Storage, "getItem">,
  key: string,
  fallback: EnhancedDraft,
): EnhancedDraft {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 40000) return fallback;
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}
export function writeEnhancedDraft(
  storage: Pick<Storage, "setItem">,
  key: string,
  draft: EnhancedDraft,
) {
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    /* In-memory draft remains usable. */
  }
}
