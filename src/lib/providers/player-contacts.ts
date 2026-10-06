import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readTeamSettings } from "./team-settings";
import type { TeamPageSettings } from "@/lib/team-page-settings";

// Keep the existing charting identity algorithm: position changes never inherit
// another player's contact details. Historical contacts stay bound to their ID.
export function rosterPlayers(
  organizationId: string,
  settings: TeamPageSettings,
) {
  return (["lead", "second", "third", "fourth"] as const)
    .filter((position) => settings.roster[position].trim())
    .map((position) => ({
      id: createHash("sha256")
        .update(
          `${organizationId}:${position}:${settings.roster[position].trim()}`,
        )
        .digest("hex"),
      name: settings.roster[position].trim(),
      position: (position[0].toUpperCase() + position.slice(1)) as
        "Lead" | "Second" | "Third" | "Fourth",
    }));
}
export const contactSchema = z
  .object({
    playerId: z.string().regex(/^[a-f0-9]{64}$/),
    email: z.union([z.literal(""), z.string().trim().email().max(254)]),
  })
  .strict();
export async function readPlayerContacts(organizationId: string) {
  const { data, error } = await createAdminSupabaseClient()
    .from("team_player_contacts")
    .select("player_id,player_name,email")
    .eq("organization_id", organizationId);
  if (error) throw new Error("Player contacts unavailable");
  return z
    .array(
      z.object({
        player_id: z.string(),
        player_name: z.string(),
        email: z.string().email().nullable(),
      }),
    )
    .parse(data);
}
export async function currentPlayerContacts(organizationId: string) {
  const [{ settings }, contacts] = await Promise.all([
    readTeamSettings(organizationId),
    readPlayerContacts(organizationId),
  ]);
  return rosterPlayers(organizationId, settings).map((p) => ({
    ...p,
    email: contacts.find((c) => c.player_id === p.id)?.email ?? "",
  }));
}
export async function savePlayerContact(
  organizationId: string,
  input: z.infer<typeof contactSchema>,
) {
  const { settings } = await readTeamSettings(organizationId);
  const player = rosterPlayers(organizationId, settings).find(
    (p) => p.id === input.playerId,
  );
  if (!player) throw new Error("Roster changed. Reload the player list.");
  const { error } = await createAdminSupabaseClient()
    .from("team_player_contacts")
    .upsert(
      {
        organization_id: organizationId,
        player_id: player.id,
        player_name: player.name,
        email: input.email.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,player_id" },
    );
  if (error) throw new Error("Player email could not be saved.");
}
