"use server";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { studioPasswordSchema } from "@/lib/auth/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { pilotPasswordRequired } from "@/lib/pilot";
export async function changePilotPassword(
  _: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const parsed = studioPasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Use matching passwords of at least 12 characters." };
  const auth = await createServerSupabaseClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user || !pilotPasswordRequired(user))
    return { error: "Sign in with your pilot credentials first." };
  if (
    createHash("sha256").update(parsed.data.password).digest("hex") ===
    user.app_metadata.pilot_temporary_password_hash
  )
    return {
      error:
        "Choose a different password from the temporary password in your email.",
    };
  const expiry = Date.parse(user.app_metadata.pilot_credentials_expire);
  if (!Number.isFinite(expiry) || expiry <= Date.now())
    return {
      error:
        "This invitation has expired. Ask your CurlStreamer administrator to resend it.",
    };
  const db = createAdminSupabaseClient();
  const { data: pilot, error } = await db
    .from("pilot_accounts")
    .select("id,organization_id,revoked_at,expires_at,email_status")
    .eq("user_id", user.id)
    .single();
  if (
    error ||
    !pilot ||
    pilot.revoked_at ||
    Date.parse(pilot.expires_at) <= Date.now() ||
    pilot.email_status === "sending"
  )
    return {
      error:
        "Pilot access is unavailable or an invitation is being sent. Try again shortly or contact your administrator.",
    };
  const changed = await db.auth.admin.updateUserById(user.id, {
    password: parsed.data.password,
    app_metadata: { pilot_password_required: false, pilot_setup_pending: true },
  });
  if (changed.error)
    return {
      error: "Password could not be changed. Try a different password.",
    };
  const activated = await db.rpc("activate_pilot_account", { p_user: user.id });
  if (activated.error)
    return {
      error:
        "Your password was changed but activation is unfinished. Retry to finish setup.",
    };
  const finished = await db.auth.admin.updateUserById(user.id, {
    app_metadata: { pilot_setup_pending: false },
  });
  if (finished.error)
    return { error: "Activation is unfinished. Retry to continue." };
  await auth.auth.refreshSession();
  redirect("/onboarding?start=1");
}
