import { z } from "zod";
import type { ResumeScope } from "./resume-storage";

const selectionSchema = z
  .object({
    seasonId: z.string().min(1).max(100),
    eventId: z.string().min(1).max(100),
    gameId: z.string().min(1).max(100),
  })
  .strict();
export type AnalysisSelection = z.infer<typeof selectionSchema>;

export function readAnalysisSelection(query: URLSearchParams) {
  const result = selectionSchema.safeParse({
    seasonId: query.get("analysisSeason"),
    eventId: query.get("analysisEvent"),
    gameId: query.get("analysisGame"),
  });
  return result.success ? result.data : undefined;
}

function storageKey(scope?: ResumeScope) {
  return `curlcoach:analysis:v1:${JSON.stringify(
    scope ? [scope.actorId, scope.organizationId] : ["sample"],
  )}`;
}

export function loadAnalysisSelection(scope?: ResumeScope) {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw || raw.length > 500) return;
    const result = selectionSchema.safeParse(JSON.parse(raw));
    if (result.success) return result.data;
  } catch {
    // Storage is optional. The current page still remembers the selection.
  }
}

export function rememberAnalysisSelection(
  selection: AnalysisSelection,
  scope?: ResumeScope,
  persist = true,
) {
  if (persist) {
    try {
      localStorage.setItem(storageKey(scope), JSON.stringify(selection));
    } catch {
      // The selection can still be restored from the URL.
    }
  }
  const url = new URL(location.href);
  url.searchParams.set("analysisSeason", selection.seasonId);
  url.searchParams.set("analysisEvent", selection.eventId);
  url.searchParams.set("analysisGame", selection.gameId);
  if (url.href !== location.href) history.replaceState(history.state, "", url);
}
