import { z } from "zod";
import {
  currentShots,
  roster,
  shotSchema,
  type Shot,
  type State,
} from "./model";
import { nextTurn } from "./next-turn";
import { resolvedLineup } from "./lineup";

export type TrackerResume = {
  draft: Shot;
  editing: string | null;
  current?: Shot;
};
export type ResumeScope = { actorId: string; organizationId: string };
// In-progress fields can be incomplete while the confirmed save schema remains strict.
const draftSchema = z.object(shotSchema.shape).strict();
const snapshotSchema = z
  .object({
    source: z.enum(["sample", "streamer"]),
    eventId: z.string().min(1).max(200),
    gameId: z.string().min(1).max(200),
    stateRevision: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    draft: draftSchema,
    editing: z.string().uuid().nullable(),
    current: draftSchema.optional(),
  })
  .strict();
export type ResumeSnapshot = z.infer<typeof snapshotSchema>;
export function validResumeSnapshot(
  value: unknown,
): ResumeSnapshot | undefined {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
const storeSchema = z
  .object({
    version: z.literal(1),
    actorId: z.string().min(1).max(200),
    organizationId: z.string().min(1).max(200),
    active: snapshotSchema.nullable(),
    drafts: z.array(snapshotSchema).max(12),
  })
  .strict();
export type ResumeStore = z.infer<typeof storeSchema>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const maxBytes = 120_000;
export function resumeId(
  value: Pick<ResumeSnapshot, "source" | "eventId" | "gameId">,
) {
  return JSON.stringify([value.source, value.eventId, value.gameId]);
}
function storageKey(scope: ResumeScope) {
  return (
    "curlcoach:resume:v1:" +
    JSON.stringify([scope.actorId, scope.organizationId])
  );
}
export function emptyResumeStore(scope: ResumeScope): ResumeStore {
  return { version: 1, ...scope, active: null, drafts: [] };
}
export function readResumeStore(
  storage: StorageLike,
  scope: ResumeScope,
): ResumeStore {
  try {
    const raw = storage.getItem(storageKey(scope));
    if (!raw || raw.length > maxBytes) return emptyResumeStore(scope);
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      parsed.data.actorId !== scope.actorId ||
      parsed.data.organizationId !== scope.organizationId
    )
      return emptyResumeStore(scope);
    return parsed.data;
  } catch {
    return emptyResumeStore(scope);
  }
}
export function writeResumeStore(storage: StorageLike, store: ResumeStore) {
  const parsed = storeSchema.safeParse(store);
  if (!parsed.success) return;
  try {
    const raw = JSON.stringify(parsed.data);
    if (raw.length <= maxBytes) storage.setItem(storageKey(store), raw);
  } catch {
    // Private browsing or a full storage quota must not interrupt tracking.
  }
}
/** Browsing records a draft without moving the explicitly active tracking anchor. */
export function rememberResume(
  store: ResumeStore,
  snapshot: ResumeSnapshot,
  activelyTracking = false,
): ResumeStore {
  if (!snapshotSchema.safeParse(snapshot).success) return store;
  return {
    ...store,
    active: activelyTracking ? snapshot : store.active,
    drafts: [
      snapshot,
      ...store.drafts.filter((entry) => resumeId(entry) !== resumeId(snapshot)),
    ].slice(0, 12),
  };
}
/** Restore only after an authorized authoritative state has been loaded. */
export function reconcileResume(
  snapshot: ResumeSnapshot,
  state: State,
  scope?: ResumeScope,
): TrackerResume | undefined {
  if (
    snapshot.gameId !== state.gameId ||
    (scope && scope.organizationId !== state.organizationId)
  )
    return;
  const players = state.roster;
  if (
    players &&
    (!players.length ||
      !players.some((player) => player.id === snapshot.draft.playerId))
  )
    return;
  const revision = state.revision ?? state.events.length;
  if (snapshot.stateRevision > revision) return;
  const shots = currentShots(state.events);
  if (
    snapshot.editing &&
    snapshot.stateRevision === revision &&
    shots.some((shot) => shot.id === snapshot.editing)
  )
    return {
      draft: snapshot.draft,
      editing: snapshot.editing,
      current: snapshot.current,
    };
  let draft = snapshot.editing
    ? (snapshot.current ?? snapshot.draft)
    : snapshot.draft;
  if (players && !players.some((player) => player.id === draft.playerId))
    return;
  // Never put a stale unsaved attempt into an already confirmed turn.
  for (let i = 0; i < 160; i++) {
    const occupied = shots.some(
      (shot) =>
        shot.end === draft.end &&
        shot.position === draft.position &&
        shot.stone === draft.stone,
    );
    if (!occupied) return { draft, editing: null, current: draft };
    const next = nextTurn(
      draft,
      shots,
      players,
      resolvedLineup(players ?? roster, state.lineup),
    );
    if (!next) return;
    draft = next;
  }
}
