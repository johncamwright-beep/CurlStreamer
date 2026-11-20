import "server-only";
import { createHmac } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function savePilotInterest(
  email: string,
  team: string,
  client: string,
) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Waitlist unavailable");
  const fingerprint = createHmac("sha256", secret)
    .update(`pilot:${client}`)
    .digest("hex");
  const { data, error } = await createAdminSupabaseClient().rpc(
    "join_pilot_waitlist",
    { p_email: email, p_team: team, p_fingerprint: fingerprint },
  );
  if (error || !["saved", "limited"].includes(data))
    throw new Error("Waitlist unavailable");
  return data as "saved" | "limited";
}
