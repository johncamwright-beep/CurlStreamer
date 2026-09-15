import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/lib/auth/account";
import { readSetupProgress } from "@/lib/onboarding";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { AppNavigation } from "@/components/AppNavigation";

export default async function SetupCompletePage() {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const context = await getAccountContext(user);
  if (!context.ok) return <AccountServiceUnavailable />;
  const membership = context.account.membership;
  if (
    context.account.profile.status !== "active" ||
    membership?.role !== "owner"
  )
    redirect("/dashboard");
  const progress = readSetupProgress(
    user.user_metadata?.team_setup,
    membership.organization_id,
  );
  if (!progress?.complete) redirect("/onboarding");
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-5 md:py-10">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <section className="panel grid gap-4">
        <h1 className="text-3xl font-black">Ready to get started</h1>
        <p>
          Your team details are saved. You can manage your page, sponsors, and
          schedule in this browser. Starting a broadcast requires CurlStreamer
          Studio on a Windows PC.
        </p>
        <p>
          Any skipped details can be completed in Account &amp; Settings or your
          game schedule.
        </p>
        {progress.gameId && (
          <Link className="btn text-center" href={`/score/${progress.gameId}`}>
            Open your first game
          </Link>
        )}
        <Link className="btn-secondary text-center" href="/dashboard">
          Go to your games
        </Link>
      </section>
    </main>
  );
}
