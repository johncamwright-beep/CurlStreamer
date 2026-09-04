import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountServiceUnavailable } from "@/components/AccountServiceUnavailable";
import { AppNavigation } from "@/components/AppNavigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadActiveTeam } from "@/lib/team-games";
import { GameCreationForm } from "./GameCreationForm";

export default async function NewGamePage() {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return <AccountServiceUnavailable />;
  }
  let auth;
  try {
    auth = await supabase.auth.getUser();
  } catch {
    return <AccountServiceUnavailable />;
  }
  const {
    data: { user },
    error,
  } = auth;
  if (error || !user?.email_confirmed_at)
    redirect("/login?next=%2Fgames%2Fnew");

  const team = await loadActiveTeam(user);
  if (team.kind === "no-team") redirect("/onboarding");
  if (team.kind === "unavailable") return <AccountServiceUnavailable />;
  if (team.kind === "inactive")
    return (
      <Denied title="Account access denied">
        This account is not currently active.
      </Denied>
    );
  if (team.kind === "multiple-teams")
    return (
      <Denied title="Team selection required">
        Choose an active team before creating a game.
      </Denied>
    );
  if (team.kind !== "ready") return <AccountServiceUnavailable />;
  if (team.team.role === "viewer")
    return (
      <Denied title="Game creation unavailable">
        Viewers cannot create games for this team.
      </Denied>
    );

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <GameCreationForm />
    </main>
  );
}

function Denied({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-screen max-w-xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <section className="panel grid gap-4" role="alert">
        <h1 className="text-3xl font-black">{title}</h1>
        <p>{children}</p>
        <Link className="min-h-11 py-3 text-cyan-300" href="/dashboard">
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}
