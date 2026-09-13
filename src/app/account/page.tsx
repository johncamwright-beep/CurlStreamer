import { AccountEmail } from "@/components/AccountEmail";
import { AccountWorkspace } from "@/components/AccountWorkspace";
import { YouTubeAccountPanel } from "@/components/YouTubeAccountPanel";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccountContext, readableTeamRole } from "@/lib/auth/account";
import Link from "next/link";
import { signOut } from "./actions";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { AppNavigation } from "@/components/AppNavigation";
import { AccountPasswordForm } from "@/components/AccountPasswordForm";
import { platformAdminContext } from "@/lib/providers/platform-admin";
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; result?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const result = await getAccountContext(user);
  if (!result.ok) return <AccountServiceUnavailable />;
  const account = result.account;
  const administrator = await platformAdminContext().catch(() => null);
  return (
    <main className="mx-auto min-h-screen max-w-5xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <h1 className="mb-5 text-3xl font-black">Account &amp; Settings</h1>
      {administrator && (
        <Link
          href="/admin"
          className="btn-secondary mb-5 inline-flex min-h-11 items-center"
        >
          Platform administration
        </Link>
      )}
      <AccountWorkspace
        initialSection={query.section ?? "account"}
        teamName={
          account.profile.status === "active"
            ? account.membership?.teamName
            : undefined
        }
        canManage={
          !!account.membership &&
          ["owner", "team_admin"].includes(account.membership.role)
        }
        youtube={
          account.profile.status === "active" && account.membership ? (
            <YouTubeAccountPanel
              searchParams={Promise.resolve({ result: query.result })}
            />
          ) : null
        }
        account={
          <div className="grid gap-4">
            <h2 className="text-xl font-bold">Account info</h2>
            <AccountEmail email={user.email ?? ""} />
            {user.identities?.some(
              (identity) => identity.provider === "google",
            ) && <AccountPasswordForm />}
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
          </div>
        }
      />
    </main>
  );
}
