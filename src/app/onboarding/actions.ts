"use server";
import { redirect } from "next/navigation";
import { firstTeamSchema } from "@/lib/auth/validation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/lib/auth/account";
import { setupProgressSchema, type SetupProgress } from "@/lib/onboarding";

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

  const context = await getAccountContext(user);
  if (!context.ok)
    return { message: "Team settings are unavailable. Try again." };
  if (context.account.membership) redirect("/onboarding");

  // The verified Auth identity is the only user ID supplied to the privileged RPC.
  const { data, error } = await createAdminSupabaseClient().rpc(
    "create_first_team",
    {
      p_user_id: user.id,
      p_team_name: parsed.data.teamName,
    },
  );
  if (error)
    return {
      message:
        error.code === "42501"
          ? "Your account cannot create a team."
          : "Team creation failed. Please try again.",
    };
  const organizationId = data?.[0]?.organization_id;
  if (organizationId) {
    await auth.auth.updateUser({
      data: { team_setup: { organizationId, step: 1, complete: false } },
    });
  }
  redirect("/onboarding?start=1");
}

export async function saveSetupProgress(value: SetupProgress) {
  const parsed = setupProgressSchema.safeParse(value);
  if (!parsed.success) return { error: "Check the setup step and try again." };
  const auth = await createServerSupabaseClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user?.email_confirmed_at) return { error: "Sign in to continue setup." };
  const context = await getAccountContext(user);
  if (
    !context.ok ||
    context.account.profile.status !== "active" ||
    context.account.membership?.role !== "owner" ||
    context.account.membership.organization_id !== parsed.data.organizationId
  )
    return { error: "Only your team's owner can manage setup." };
  const { error } = await auth.auth.updateUser({
    data: { team_setup: parsed.data },
  });
  if (!error && parsed.data.complete) redirect("/onboarding/complete");
  return error
    ? { error: "Progress could not be saved. Please try again." }
    : { success: true };
}
