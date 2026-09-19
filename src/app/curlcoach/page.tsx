import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { authorized, labEnabled, sessionCookie } from "@/lib/curlcoach/access";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { AppNavigation } from "@/components/AppNavigation";
import EventWorkspace from "./EventWorkspace";
export const dynamic = "force-dynamic";
export default async function CoachPage() {
  if (labEnabled())
    return (
      <EventWorkspace
        unlocked={await authorized((await cookies()).get(sessionCookie)?.value)}
      />
    );
  if (process.env.CURLCOACH_ENABLED !== "true") notFound();
  const account = await requireCoachAccount();
  if (!account)
    return (
      <main className="mx-auto max-w-3xl p-6">
        <AppNavigation />
        <h1 className="text-2xl font-bold">Private coaching</h1>
        <p>
          Shot Tracker requires an enabled team subscription and coach access
          for your account.
        </p>
        <Link
          className="inline-flex min-h-11 items-center underline"
          href="/account"
        >
          Return to Account &amp; Settings
        </Link>
      </main>
    );
  return (
    <>
      <AppNavigation signedIn />
      <EventWorkspace mode="streamer" unlocked />
    </>
  );
}
