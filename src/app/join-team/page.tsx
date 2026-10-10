import { JoinTeam } from "./JoinTeam";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  readTeamInvitation,
  teamInvitationToken,
} from "@/lib/providers/team-invitation";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function JoinTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!teamInvitationToken.safeParse(token).success) return <JoinTeam />;
  try {
    const {
      data: { user },
    } = await (await createServerSupabaseClient()).auth.getUser();
    const invitation = await readTeamInvitation(token!, user?.id);
    if (!invitation) return <JoinTeam />;
    return (
      <JoinTeam
        token={token}
        {...invitation}
        email={user?.email_confirmed_at ? user.email : undefined}
      />
    );
  } catch {
    return <JoinTeam unavailable />;
  }
}
