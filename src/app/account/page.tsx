import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccountContext, readableTeamRole } from "@/lib/auth/account";
import Link from "next/link";
import { signOut } from "./actions";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { AppNavigation } from "@/components/AppNavigation";
export default async function AccountPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const result = await getAccountContext(user);
  if (!result.ok) return <AccountServiceUnavailable />;
  const account = result.account;
  return (
    <main className="mx-auto min-h-screen max-w-xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <section className="panel grid gap-4">
        <h1 className="text-3xl font-black">My account</h1>
        <dl>
          <dt className="text-slate-400">Display name</dt>
          <dd>{account.profile.display_name}</dd>
          <dt className="mt-3 text-slate-400">Email</dt>
          <dd>{user.email}</dd>
        </dl>
        {account.profile.status !== "active" ? (
          <p role="alert" className="text-red-300">
            This account is not currently active.
          </p>
        ) : account.membership ? (
          <div className="grid gap-3">
            <dl>
              <dt className="text-slate-400">Team</dt>
              <dd>{account.membership.teamName}</dd>
              <dt className="mt-3 text-slate-400">Team role</dt>
              <dd>{readableTeamRole(account.membership.role)}</dd>
            </dl>
            <Link className="btn text-center" href="/dashboard">
              Open team dashboard
            </Link>
          </div>
        ) : (
          <Link className="btn text-center" href="/onboarding">
            Create your team
          </Link>
        )}
        <form action={signOut}>
          <button className="btn-secondary w-full">Sign Out</button>
        </form>
        <Link className="min-h-11 py-3 text-center text-cyan-300" href="/">
          Return to CurlStreamer
        </Link>
      </section>
    </main>
  );
}
