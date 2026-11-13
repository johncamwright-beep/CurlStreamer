import { cookies } from "next/headers";
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
  const enabled = process.env.CURLCOACH_ENABLED === "true";
  const account = enabled ? await requireCoachAccount() : null;
  if (!account)
    return (
      <main className="mx-auto max-w-3xl p-6">
        <AppNavigation />
        <h1 className="text-2xl font-bold">Shot Tracker</h1>
        <p>
          Shot Tracker requires a CurlStreamer add-on subscription. Your team
          needs an active Shot Tracker licence, and your team owner must assign
          you a coaching seat.
        </p>
        {!enabled && <p>Charting is currently unavailable.</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link className="btn min-h-11" href="/account?section=subscription">
            View trial &amp; subscription
          </Link>
          <Link
            className="btn-secondary min-h-11"
            href="/account?section=members"
          >
            View team access
          </Link>
        </div>
      </main>
    );
  return (
    <>
      <AppNavigation signedIn />
      <EventWorkspace
        mode="streamer"
        unlocked
        accountScope={{
          actorId: account.userId,
          organizationId: account.organizationId,
        }}
      />
    </>
  );
}
