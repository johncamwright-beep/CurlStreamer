"use server";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { teamInvitationToken } from "@/lib/providers/team-invitation";

export async function switchInvitationAccount(form: FormData) {
  const token = teamInvitationToken.safeParse(form.get("token"));
  if (!token.success) redirect("/join-team");
  await (await createServerSupabaseClient()).auth.signOut();
  redirect(`/join-team?token=${encodeURIComponent(token.data)}`);
}
