import { redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { SponsorLibrary } from "@/components/SponsorLibrary";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { libraryForAccount } from "@/lib/providers/sponsor-library";

export const dynamic = "force-dynamic";
export default async function SponsorsPage() {
  const { data } = await (await createServerSupabaseClient()).auth.getUser();
  if (!data.user?.email_confirmed_at) redirect("/login");
  let library;
  try {
    library = await libraryForAccount(data.user);
  } catch {
    redirect("/onboarding");
  }
  return (
    <main className="mx-auto min-h-screen max-w-5xl p-5 md:py-10">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <header className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-cyan-300">
          {library.teamName}
        </p>
        <h1 className="text-4xl font-black">Sponsors</h1>
        <p className="mt-2 text-slate-300">
          One active library for every team game. Changes appear on the next
          refresh.
        </p>
      </header>
      <SponsorLibrary
        initial={library.sponsors}
        canManage={library.role === "owner" || library.role === "team_admin"}
      />
    </main>
  );
}
