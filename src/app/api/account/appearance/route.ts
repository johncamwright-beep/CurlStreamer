import { readTeamSettings } from "@/lib/providers/team-settings";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/lib/auth/account";
import { teamLogoSource } from "@/components/TeamLogo";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const db = await createServerSupabaseClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user?.email_confirmed_at)
      return NextResponse.json({ logo: null }, { headers });
    const result = await getAccountContext(user);
    const team = result.ok ? result.account.membership?.teamName : undefined;
    const saved =
      result.ok && result.account.membership
        ? await readTeamSettings(
            result.account.membership.organization_id,
          ).catch(() => null)
        : null;
    return NextResponse.json(
      { logo: saved?.logo || (team ? teamLogoSource(team) : null) },
      { headers },
    );
  } catch {
    return NextResponse.json({ logo: null }, { headers });
  }
}
