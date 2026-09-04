import { redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { OpponentDirectory } from "@/components/OpponentDirectory";
import { getAccountContext } from "@/lib/auth/account";
import { listOpponents } from "@/lib/team-hierarchy-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function OpponentsPage() {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login?next=%2Fopponents");
  const [context, result] = await Promise.all([
    getAccountContext(user),
    listOpponents(user, true),
  ]);
  if (!context.ok || !context.account.membership || !result.ok)
    return (
      <main className="p-5" role="alert">
        Opponents could not be loaded.
      </main>
    );
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <header className="panel mb-5">
        <p className="text-cyan-300">{context.account.membership.teamName}</p>
        <h1 className="text-3xl font-black">Opponents</h1>
        <p className="text-slate-300">
          Remember teams for faster game scheduling. Archiving never changes
          past games.
        </p>
      </header>
      <OpponentDirectory
        opponents={result.value as never[]}
        canEdit={context.account.membership.role !== "viewer"}
      />
    </main>
  );
}
