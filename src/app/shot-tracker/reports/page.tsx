import { notFound } from "next/navigation";
import { AppNavigation } from "@/components/AppNavigation";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import EventReportLibrary from "@/app/curlcoach/EventReportLibrary";
export const dynamic = "force-dynamic";
export default async function ReportsPage() {
  if (
    process.env.CURLCOACH_ENABLED !== "true" ||
    !(await requireCoachAccount())
  )
    notFound();
  return (
    <>
      <AppNavigation signedIn />
      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <EventReportLibrary />
      </main>
    </>
  );
}
