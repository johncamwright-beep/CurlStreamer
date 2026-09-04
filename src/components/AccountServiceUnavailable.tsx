import Link from "next/link";
import { signOut } from "@/app/account/actions";
import { AppNavigation } from "@/components/AppNavigation";

export function AccountServiceUnavailable() {
  return (
    <main className="mx-auto min-h-screen max-w-xl p-5 md:py-12">
      <div className="mb-4">
        <AppNavigation signedIn />
      </div>
      <section className="panel grid gap-4" role="alert" aria-live="polite">
        <h1 className="text-3xl font-black">
          Account services are temporarily unavailable
        </h1>
        <p>Please try again later. CurlStreamer game tools remain available.</p>
        <Link className="btn text-center" href="/">
          Return to CurlStreamer
        </Link>
        <form action={signOut}>
          <button className="btn-secondary w-full">Sign Out</button>
        </form>
      </section>
    </main>
  );
}
