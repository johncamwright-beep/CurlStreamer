export const CELEBRATION_TEMPLATES = [
  {
    id: "lightsaber",
    label: "Lightsaber",
    description: "Your player's big-head lightsaber moment.",
    durationMs: 6167,
  },
  {
    id: "cat-dance",
    label: "Cat Dance",
    description: "Your player's big-head cat dance moment.",
    durationMs: 9700,
  },
  {
    id: "trump-dance",
    label: "Trump Dance",
    description: "Your player's dance with animated party lights.",
    durationMs: 9667,
  },
] as const;
export const CELEBRATION_TEMPLATE_IDS = [
  "lightsaber",
  "cat-dance",
  "trump-dance",
] as const;
export type CelebrationTemplateId = (typeof CELEBRATION_TEMPLATE_IDS)[number];
export interface CelebrationCue {
  id: string;
  templateId: CelebrationTemplateId;
  playerId: string;
  playerName: string;
  headshotUrl?: string | null;
  startedAt: number;
  expiresAt: number;
  volume: number;
  muted: boolean;
}
export function getCelebrationTemplate(id: CelebrationTemplateId) {
  return CELEBRATION_TEMPLATES.find((template) => template.id === id)!;
}
/** Absolute timestamps prevent a refreshed program output from replaying a clip. */
export function getCelebrationProgress(
  cue: CelebrationCue,
  now: number,
): number | null {
  const duration = getCelebrationTemplate(cue.templateId)?.durationMs;
  if (
    !duration ||
    !Number.isFinite(now) ||
    !Number.isFinite(cue.startedAt) ||
    !Number.isFinite(cue.expiresAt) ||
    now < cue.startedAt ||
    now >= cue.expiresAt ||
    now >= cue.startedAt + duration
  )
    return null;
  return (now - cue.startedAt) / duration;
}
