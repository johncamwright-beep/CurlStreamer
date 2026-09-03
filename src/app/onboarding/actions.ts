"use server";
import { redirect } from "next/navigation";
import { firstTeamSchema } from "@/lib/auth/validation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type FirstTeamState = {
  message?: string;
  errors?: Record<string, string[]>;
};

export async function createFirstTeam(
  _: FirstTeamState,
  formData: FormData,
): Promise<FirstTeamState> {
  const parsed = firstTeamSchema.safeParse({
    teamName: formData.get("teamName"),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const auth = await createServerSupabaseClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");

  // The verified Auth identity is the only user ID supplied to the privileged RPC.
  const { error } = await createAdminSupabaseClient().rpc("create_first_team", {
    p_user_id: user.id,
    p_team_name: parsed.data.teamName,
  });
  if (error)
    return {
      message:
        error.code === "42501"
          ? "Your account cannot create a team."
          : "Team creation failed. Please try again.",
    };
  redirect("/dashboard");
}
