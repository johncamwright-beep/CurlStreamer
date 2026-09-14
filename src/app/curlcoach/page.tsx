import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { authorized, labEnabled, sessionCookie } from "@/lib/curlcoach/access";
import EventWorkspace from "./EventWorkspace";

export const dynamic = "force-dynamic";
export default async function CoachPage() {
  if (!labEnabled()) notFound();
  return (
    <EventWorkspace
      unlocked={await authorized((await cookies()).get(sessionCookie)?.value)}
    />
  );
}
