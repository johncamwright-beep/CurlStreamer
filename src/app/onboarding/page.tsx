import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth/account";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FirstTeamForm } from "./FirstTeamForm";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { AppNavigation } from "@/components/AppNavigation";
import { readSetupProgress } from "@/lib/onboarding";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";
import { listOpponents } from "@/lib/team-hierarchy-service";
import { YouTubeAccountPanel } from "@/components/YouTubeAccountPanel";
import { SetupWizard } from "./SetupWizard";
import "../games/new/setup.css";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const result = await getAccountContext(user);
  if (!result.ok) return <AccountServiceUnavailable />;
  const account = result.account;
  if (account.profile.status !== "active") return <AccessDenied />;
  if (account.membership) {
    const membership = account.membership;
    if (membership.role !== "owner") redirect("/dashboard");
    const saved = readSetupProgress(
      user.user_metadata?.team_setup,
      membership.organization_id,
    );
    // Explicit start also makes progress recoverable if the first metadata save failed.
    if ((!saved || saved.complete) && (await searchParams).start !== "1")
      redirect("/dashboard");
    const [hierarchy, opponents] = await Promise.all([
      loadTeamHierarchyData(user),
      listOpponents(user),
    ]);
    if (!hierarchy.ok || !opponents.ok) return <AccountServiceUnavailable />;
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-5 md:py-10">
        <div className="mb-4">
          <AppNavigation signedIn />
        </div>
        <SetupWizard
          initial={
            saved && !saved.complete
              ? saved
              : {
                  organizationId: membership.organization_id,
                  step: 1,
                  complete: false,
                }
          }
          teamName={membership.teamName}
          seasons={hierarchy.seasons}
          events={hierarchy.events}
          games={hierarchy.games}
          opponents={opponents.value as { id: string; display_name: string }[]}
          youtube={<YouTubeAccountPanel searchParams={Promise.resolve({})} />}
        />
      </main>
    );
  }
  return (
    <main className="mx-auto min-h-screen max-w-md p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <FirstTeamForm />
    </main>
  );
}

function AccessDenied() {
  return (
    <main className="mx-auto min-h-screen max-w-md p-5 md:py-12">
      <section className="panel grid gap-4">
        <h1 className="text-3xl font-black">Account access denied</h1>
        <p>This account is not currently active.</p>
        <Link className="min-h-11 py-3 text-cyan-300" href="/">
          Return to CurlStreamer
        </Link>
      </section>
    </main>
  );
}
