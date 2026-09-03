import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ensureOwnProfile } from "@/lib/auth/profile";
import { signOut } from "./actions";
export default async function AccountPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect("/login");
  const profile = await ensureOwnProfile(user);
  return (
    <main className="mx-auto min-h-screen max-w-xl p-5 md:py-12">
      <section className="panel grid gap-4">
        <h1 className="text-3xl font-black">My account</h1>
        <dl>
          <dt className="text-slate-400">Display name</dt>
          <dd>{profile?.display_name}</dd>
          <dt className="mt-3 text-slate-400">Email</dt>
          <dd>{user.email}</dd>
        </dl>
        <p>Team setup will be available next</p>
        <form action={signOut}>
          <button className="btn-secondary w-full">Sign Out</button>
        </form>
      </section>
    </main>
  );
}
