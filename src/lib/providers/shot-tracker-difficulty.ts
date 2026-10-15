import "server-only";
import type { CoachEvent } from "@/lib/curlcoach/event";
import { difficultyRecords } from "@/lib/curlcoach/difficulty";
import { analysisRecords } from "@/lib/curlcoach/advanced-analysis";
import { loadEnhanced } from "./shot-tracker-enhanced";
import { readLocalEnhanced } from "./curlcoach-local";

/** The caller must first resolve an authorized workspace. Supplement failures never hide Standard statistics. */
export async function loadEventDifficulty(
  event: CoachEvent,
  actorUserId: string,
  local = false,
) {
  for (let offset = 0; offset < event.games.length; offset += 6) {
    await Promise.all(
      event.games.slice(offset, offset + 6).map(async (game) => {
        try {
          const documents = local
            ? readLocalEnhanced(game.state, actorUserId)
            : await loadEnhanced(
                {
                  organizationId: event.organizationId,
                  actorUserId,
                  gameId: game.id,
                },
                game.state,
              );
          game.difficultyRecords = difficultyRecords(game.state, documents);
          game.difficultyReady = true;
          game.analysisRecords = analysisRecords(game.state, documents);
          game.analysisReady = true;
        } catch {
          game.difficultyRecords = [];
          game.difficultyReady = false;
          game.analysisRecords = [];
          game.analysisReady = false;
        }
      }),
    );
  }
}
