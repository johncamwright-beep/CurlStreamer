import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function ensureOwnProfile(user: User) {
  if (!user.email_confirmed_at) throw new Error("Verified account required");
  const displayName =
    typeof user.user_metadata?.display_name === "string" &&
    user.user_metadata.display_name.trim()
      ? user.user_metadata.display_name.trim().slice(0, 100)
      : user.email?.split("@")[0] || "CurlStreamer user";
  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from("user_profiles")
    .upsert(
      { user_id: user.id, display_name: displayName },
      { onConflict: "user_id", ignoreDuplicates: true },
    )
    .select("display_name");
  if (error) throw new Error("Account profile initialization failed");
  const profile =
    data?.[0] ??
    (
      await db
        .from("user_profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .single()
    ).data;
  if (!data?.length) return profile;
  const { error: auditError } = await db.from("audit_events").insert({
    actor_user_id: user.id,
    action: "account.profile_initialized",
    subject_type: "user_profile",
    subject_identifier: user.id,
    metadata: {},
  });
  if (auditError && auditError.code !== "23505")
    console.error("Account profile audit failed", { code: auditError.code });
  return profile;
}
