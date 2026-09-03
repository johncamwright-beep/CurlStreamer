import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth/account";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FirstTeamForm } from "./FirstTeamForm";

export default async function OnboardingPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const account = await getAccountContext(user);
  if (account.profile.status !== "active") return <AccessDenied />;
  if (account.membership) redirect("/dashboard");
  return (
    <main className="mx-auto min-h-screen max-w-md p-5 md:py-12">
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
        <a className="min-h-11 py-3 text-cyan-300" href="/">
          Return to CurlStreamer
        </a>
      </section>
    </main>
  );
}
