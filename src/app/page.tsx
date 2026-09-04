import { redirect } from "next/navigation";
import { login } from "@/app/login/actions";
import { AuthForm } from "@/components/AuthForm";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function HomePage() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email_confirmed_at) redirect("/dashboard");
  } catch (error) {
    if (error instanceof Error && error.message.includes("NEXT_REDIRECT"))
      throw error;
    return <AuthenticationUnavailable />;
  }
  return <AuthForm mode="login" action={login} />;
}

function AuthenticationUnavailable() {
  return (
    <main className="mx-auto min-h-screen max-w-md p-5 md:py-12">
      <section className="panel grid gap-4" role="alert" aria-live="polite">
        <p className="font-bold tracking-widest text-cyan-300">CURLSTREAMER</p>
        <h1 className="text-3xl font-black">
          Sign in is temporarily unavailable
        </h1>
        <p>
          Please try again later. Existing game and camera links still work.
        </p>
      </section>
    </main>
  );
}
