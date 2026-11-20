import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeGame,
  authorizationError,
  operatorRoles,
} from "@/lib/game-authorization";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getGame } from "@/lib/store";
export const dynamic = "force-dynamic";
const rowSchema = z.object({
  camera_role: z.enum(["camera-home", "camera-away"]),
  status: z.string(),
  receiver_seen_at: z.string(),
  camera_seen_at: z.string().nullable(),
  expires_at: z.string(),
  camera_device_id: z.string().nullable(),
  assignment_generation: z.coerce.number().nullable(),
});
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = z.uuid().safeParse((await params).id);
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "cache-control": "no-store" },
    });
  if (!id.success) return reply({ error: "Invalid game" }, 400);
  const auth = await authorizeGame(request, id.data, {
    accountRoles: operatorRoles,
    tokenAllowed: (a) => a.purpose === "organizer",
  });
  if (!auth.ok) {
    const e = authorizationError(auth);
    return reply({ error: e.error }, e.status);
  }
  try {
    const game = await getGame(id.data);
    if (!game) return reply({ error: "Game not found" }, 404);
    const result = await createAdminSupabaseClient()
      .from("m2_studio_sessions")
      .select(
        "camera_role,status,receiver_seen_at,camera_seen_at,expires_at,camera_device_id,assignment_generation",
      )
      .eq("game_id", id.data);
    const rows = z.array(rowSchema).safeParse(result.data);
    if (result.error || !rows.success)
      return reply({ error: "Connection status unavailable" }, 503);
    const now = Date.now();
    const cameras = Object.fromEntries(
      (["camera-home", "camera-away"] as const).map((role) => {
        const row = rows.data.find((r) => r.camera_role === role);
        const receiverReady = Boolean(
          row &&
          row.status === "active" &&
          Date.parse(row.expires_at) > now &&
          Date.parse(row.receiver_seen_at) > now - 30000,
        );
        const phoneOnline = Boolean(
          receiverReady &&
          row &&
          game.claims[role] &&
          row.camera_device_id === game.claims[role] &&
          row.assignment_generation === (game.claimGenerations?.[role] ?? 0) &&
          row.camera_seen_at &&
          Date.parse(row.camera_seen_at) > now - 30000,
        );
        return [role, { receiverReady, phoneOnline }];
      }),
    );
    return reply({ cameras });
  } catch {
    return reply({ error: "Connection status unavailable" }, 503);
  }
}
