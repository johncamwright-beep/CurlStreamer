import { NextResponse } from "next/server";
import { labEnabled } from "@/lib/curlcoach/access";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { listReportEvents } from "@/lib/providers/shot-tracker-reports";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  if (process.env.CURLCOACH_ENABLED !== "true" || labEnabled())
    return new NextResponse(null, { status: 404, headers });
  try {
    const account = await requireCoachAccount();
    if (!account)
      return NextResponse.json(
        { error: "Private Shot Tracker access is required." },
        { status: 403, headers },
      );
    return NextResponse.json(
      { events: await listReportEvents(account) },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Your event list is unavailable. Please try again." },
      { status: 503, headers },
    );
  }
}
