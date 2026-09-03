import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext, readableTeamRole } from "@/lib/auth/account";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signOut } from "@/app/account/actions";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const account = await getAccountContext(user);
  if (account.profile.status !== "active") {
    return (
      <main className="mx-auto min-h-screen max-w-xl p-5 md:py-12">
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
  if (!account.membership) redirect("/onboarding");
  return (
    <main className="mx-auto min-h-screen max-w-xl p-5 md:py-12">
      <section className="panel grid gap-4">
        <h1 className="text-3xl font-black">{account.membership.teamName}</h1>
        <dl>
          <dt className="text-slate-400">Signed-in user</dt>
          <dd>
            {account.profile.display_name}
            {user.email ? ` (${user.email})` : ""}
          </dd>
          <dt className="mt-3 text-slate-400">Membership role</dt>
          <dd>{readableTeamRole(account.membership.role)}</dd>
        </dl>
        <p>Team game management will be connected next.</p>
        <Link className="btn text-center" href="/">
          Open current game setup
        </Link>
        <Link className="btn-secondary text-center" href="/account">
          My account
        </Link>
        <form action={signOut}>
          <button className="btn-secondary w-full">Sign Out</button>
        </form>
      </section>
    </main>
  );
}
