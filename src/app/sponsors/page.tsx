import { redirect } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SponsorLibrary } from "./SponsorLibrary";

export default async function SponsorsPage() {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  return (
    <main className="mx-auto max-w-6xl p-5 md:py-10">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <p className="text-cyan-300">PLAN &amp; SCHEDULE</p>
      <h1 className="mb-2 text-4xl font-black">Sponsors</h1>
      <p className="mb-6 text-slate-300">
        Manage the sponsor images used dynamically by every team game.
      </p>
      <SponsorLibrary />
    </main>
  );
}
