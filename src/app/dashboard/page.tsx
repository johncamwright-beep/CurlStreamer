import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext, readableTeamRole } from "@/lib/auth/account";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signOut } from "@/app/account/actions";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { listTeamGames } from "@/lib/team-games";
import { TeamGameLinks } from "@/components/TeamGameLinks";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const result = await getAccountContext(user);
  if (!result.ok) return <AccountServiceUnavailable />;
  const account = result.account;
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
  const gamesResult = await listTeamGames(user);
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
        <div className="grid gap-3">
          <h2 className="text-2xl font-bold">Team games</h2>
          {!gamesResult.ok ? (
            <div role="alert" className="rounded-lg bg-slate-800 p-4">
              <p>Games could not be loaded right now.</p>
              <Link
                className="inline-block min-h-11 py-3 text-cyan-300"
                href="/dashboard"
              >
                Try again
              </Link>
            </div>
          ) : gamesResult.games.length === 0 ? (
            <div className="rounded-lg bg-slate-800 p-4">
              <p>No games have been created for this team yet.</p>
              <Link
                className="inline-block min-h-11 py-3 text-cyan-300"
                href="/"
              >
                Create a game
              </Link>
            </div>
          ) : (
            <ul className="grid gap-3">
              {gamesResult.games.map((game) => (
                <li key={game.game_id} className="rounded-lg bg-slate-800 p-4">
                  <h3 className="font-bold">{game.event_name}</h3>
                  <p>
                    {game.home_name} vs. {game.away_name}
                  </p>
                  <p className="text-sm text-slate-400">
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                    }).format(new Date(game.created_at))}{" "}
                    · {game.game_status}
                  </p>
                  <TeamGameLinks gameId={game.game_id} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-slate-300">
            Account-based control from another device is coming next. For now,
            setup, scoring, and Broadcast links appear only on the browser that
            created the game.
          </p>
          <Link className="btn text-center" href="/">
            Create a game
          </Link>
        </div>
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
