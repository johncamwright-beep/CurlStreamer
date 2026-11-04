import type { z } from "zod";
import type { actionSchema } from "./schema";
import type { GameState } from "./types";
import { CELEBRATION_TEMPLATES } from "./player-celebrations";
/** Independent append-only visual intents never mutate scoring or camera state. */
export function applyCelebrationAction(
  game: GameState,
  action: z.infer<typeof actionSchema>,
  now: number,
) {
  if (action.type !== "celebration-play" && action.type !== "celebration-stop")
    return;
  const events = (game.celebrationEvents ??= []);
  if (
    events.some(
      (event) =>
        (event.type === "play" ? event.cue.id : event.id) === action.triggerId,
    )
  )
    return;
  if (action.type === "celebration-stop") {
    events.push({ type: "stop", id: action.triggerId, at: now });
    return;
  }
  const template = CELEBRATION_TEMPLATES.find(
    (template) => template.id === action.templateId,
  )!;
  events.push({
    type: "play",
    cue: {
      id: action.triggerId,
      templateId: action.templateId,
      playerId: action.playerId,
      playerName: action.playerName ?? "",
      ...(action.headshotUrl ? { headshotUrl: action.headshotUrl } : {}),
      startedAt: now + 2500,
      expiresAt: now + 2500 + template.durationMs,
      volume: action.volume,
      muted: action.muted,
    },
  });
}
export function currentCelebration(
  game: Pick<GameState, "celebrationEvents">,
  now = Date.now(),
) {
  const latest = game.celebrationEvents?.at(-1);
  return latest?.type === "play" &&
    CELEBRATION_TEMPLATES.some(
      (template) => template.id === latest.cue.templateId,
    ) &&
    latest.cue.expiresAt > now
    ? latest.cue
    : undefined;
}
