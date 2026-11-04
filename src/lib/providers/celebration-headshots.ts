import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readTeamSettings } from "./team-settings";
import { rosterPlayers } from "./player-contacts";
import type {
  CelebrationHeadshot,
  CelebrationRosterPlayer,
} from "@/lib/celebration-headshots";
const BUCKET = "celebration-headshots";
export const headshotInputSchema = z
  .object({ playerId: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const coachHeadshotInputSchema = z
  .object({
    kind: z.literal("coach"),
    playerName: z.string().trim().min(1).max(100),
    playerId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
/** A separate celebration identity; never changes curling charting identities. */
export function celebrationCoachId(organizationId: string) {
  return createHash("sha256")
    .update(`${organizationId}:celebration-coach:v1`)
    .digest("hex");
}
const rowsSchema = z.array(
  z.object({
    id: z.uuid(),
    roster_player_id: z.string(),
    player_name: z.string(),
    storage_path: z.string(),
    person_kind: z.enum(["roster", "coach"]).default("roster"),
  }),
);
export async function readCelebrationHeadshots(organizationId: string) {
  const [{ settings }, result] = await Promise.all([
    readTeamSettings(organizationId),
    createAdminSupabaseClient()
      .from("team_celebration_headshots")
      .select("id,roster_player_id,player_name,storage_path,person_kind")
      .eq("organization_id", organizationId),
  ]);
  if (result.error) throw Error("Headshots unavailable");
  const players: CelebrationRosterPlayer[] = rosterPlayers(
    organizationId,
    settings,
  ).map((player) => ({ ...player, kind: "roster" }));
  const rows = rowsSchema.parse(result.data);
  const coach = rows.find(
    (row) =>
      row.person_kind === "coach" &&
      row.roster_player_id === celebrationCoachId(organizationId) &&
      row.player_name.trim().length > 0 &&
      row.player_name.length <= 100 &&
      row.storage_path.startsWith(organizationId + "/"),
  );
  if (coach)
    players.push({
      id: coach.roster_player_id,
      name: coach.player_name,
      position: "Coach",
      kind: "coach",
    });
  const headshots: CelebrationHeadshot[] = [];
  for (const player of players) {
    const row = rows.find(
      (row) =>
        row.roster_player_id === player.id &&
        row.player_name === player.name &&
        row.person_kind === player.kind,
    );
    if (!row || !row.storage_path.startsWith(organizationId + "/")) continue;
    const signed = await createAdminSupabaseClient()
      .storage.from(BUCKET)
      .createSignedUrl(row.storage_path, 300);
    if (signed.error || !signed.data?.signedUrl)
      throw Error("Player photo unavailable");
    headshots.push({
      id: row.id,
      rosterPlayerId: player.id,
      playerName: player.name,
      position: player.position,
      imageUrl: signed.data.signedUrl,
    });
  }
  return { players, headshots };
}
export async function saveCelebrationHeadshot(
  organizationId: string,
  playerId: string,
  file: File,
) {
  const { settings } = await readTeamSettings(organizationId);
  const player = rosterPlayers(organizationId, settings).find(
    (player) => player.id === playerId,
  );
  if (!player) throw Error("Roster changed. Reload before saving.");
  return saveHeadshotIdentity(organizationId, player, file, "roster");
}
export async function saveCelebrationCoachHeadshot(
  organizationId: string,
  input: z.infer<typeof coachHeadshotInputSchema>,
  file: File,
) {
  const checked = coachHeadshotInputSchema.parse(input);
  const id = celebrationCoachId(organizationId);
  if (checked.playerId && checked.playerId !== id)
    throw Error("Coach identity does not belong to this team.");
  return saveHeadshotIdentity(
    organizationId,
    { id, name: checked.playerName },
    file,
    "coach",
  );
}
async function saveHeadshotIdentity(
  organizationId: string,
  player: { id: string; name: string },
  file: File,
  kind: "roster" | "coach",
) {
  const bytes = await normalizeCelebrationHeadshot(file);
  const db = createAdminSupabaseClient();
  const path = `${organizationId}/${randomUUID()}.png`;
  const upload = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/png",
    cacheControl: "31536000",
  });
  if (upload.error) throw Error("Photo upload failed.");
  const result = await db.from("team_celebration_headshots").upsert(
    {
      organization_id: organizationId,
      roster_player_id: player.id,
      player_name: player.name,
      person_kind: kind,
      storage_path: path,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,roster_player_id" },
  );
  if (result.error) {
    await db.storage.from(BUCKET).remove([path]);
    throw Error("Photo could not be saved.");
  }
  await pruneObsoleteHeadshots(organizationId);
  return readCelebrationHeadshots(organizationId);
}
export async function normalizeCelebrationHeadshot(file: File) {
  if (
    file.type !== "image/png" ||
    file.size === 0 ||
    file.size > 2 * 1024 * 1024
  )
    throw Error("Upload a prepared PNG under 2 MB.");
  const source = sharp(new Uint8Array(await file.arrayBuffer()), {
    limitInputPixels: 4_000_000,
    failOn: "warning",
  });
  const metadata = await source.metadata();
  if (
    metadata.format !== "png" ||
    !metadata.hasAlpha ||
    (metadata.pages ?? 1) !== 1
  )
    throw Error("Use a transparent PNG cutout.");
  const stats = await source.clone().stats();
  const alpha = stats.channels[stats.channels.length - 1];
  if (!alpha || alpha.min === 255 || alpha.max === 0)
    throw Error("Use a visible head cutout with a transparent background.");
  const bytes = await source
    .rotate()
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  if (bytes.length > 2 * 1024 * 1024)
    throw Error("Prepared photo is too large.");
  return bytes;
}
/** Caller must authorize operating the game before invoking this service-only lookup. */
export async function resolveCelebrationPlayerForGame(
  gameId: string,
  headshotId: string,
) {
  const db = createAdminSupabaseClient();
  const game = await db
    .from("games")
    .select("organization_id")
    .eq("id", z.uuid().parse(gameId))
    .single();
  if (game.error || !game.data?.organization_id)
    throw Error("Game unavailable");
  const { headshots } = await readCelebrationHeadshots(
    game.data.organization_id,
  );
  const shot = headshots.find((shot) => shot.id === z.uuid().parse(headshotId));
  if (!shot) throw Error("Player photo is unavailable. Reload the roster.");
  return {
    playerId: shot.id,
    playerName: shot.playerName,
    headshotUrl: shot.imageUrl,
  };
}

export async function celebrationGameOrganization(gameId: string) {
  const game = await createAdminSupabaseClient()
    .from("games")
    .select("organization_id")
    .eq("id", z.uuid().parse(gameId))
    .single();
  if (game.error || !game.data?.organization_id)
    throw Error("Game unavailable");
  return game.data.organization_id as string;
}
export async function resolveCelebrationRosterPlayerForGame(
  gameId: string,
  playerId: string,
) {
  const organizationId = await celebrationGameOrganization(gameId);
  const { players, headshots } = await readCelebrationHeadshots(organizationId);
  const player = players.find(
    (player) => player.id === headshotInputSchema.parse({ playerId }).playerId,
  );
  if (!player) throw Error("Roster changed. Reload the player list.");
  const headshot = headshots.find((shot) => shot.rosterPlayerId === player.id);
  if (!headshot) throw Error("Upload a photo for the selected person first.");
  return {
    playerId: player.id,
    playerName: player.name,
    headshotUrl: headshot.imageUrl,
  };
}

/** Keep old cutouts for an hour so in-flight celebration cues remain loadable. */
export async function pruneObsoleteHeadshots(organizationId: string) {
  const db = createAdminSupabaseClient();
  const current = await db
    .from("team_celebration_headshots")
    .select("storage_path")
    .eq("organization_id", organizationId);
  if (current.error) return;
  const active = new Set((current.data ?? []).map((row) => row.storage_path));
  const listed = await db.storage.from(BUCKET).list(organizationId, {
    limit: 1000,
    sortBy: { column: "created_at", order: "asc" },
  });
  if (listed.error) return;
  const paths = (listed.data ?? [])
    .filter(
      (file) =>
        /^[a-f0-9-]+\.png$/.test(file.name) &&
        file.created_at &&
        new Date(file.created_at).getTime() < Date.now() - 3600_000 &&
        !active.has(`${organizationId}/${file.name}`),
    )
    .map((file) => `${organizationId}/${file.name}`);
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
}
export async function removeCelebrationHeadshot(
  organizationId: string,
  headshotId: string,
) {
  const result = await createAdminSupabaseClient()
    .from("team_celebration_headshots")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", z.uuid().parse(headshotId));
  if (result.error) throw Error("Photo could not be removed");
  await pruneObsoleteHeadshots(organizationId);
  return readCelebrationHeadshots(organizationId);
}
