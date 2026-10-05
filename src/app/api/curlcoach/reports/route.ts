import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, labEnabled } from "@/lib/curlcoach/access";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { reportRequestSchema } from "@/lib/curlcoach/reports";
import {
  getEventReports,
  generateEventReports,
  loadReportEvent,
  ReportError,
} from "@/lib/providers/shot-tracker-reports";
export const runtime = "nodejs";
export const maxDuration = 150;
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: Request, write: boolean) {
  if (process.env.CURLCOACH_ENABLED !== "true" || labEnabled())
    return new NextResponse(null, { status: 404, headers });
  if (write && !sameOrigin(request))
    return new NextResponse(null, { status: 403, headers });
  try {
    const account = await requireCoachAccount();
    if (!account)
      return NextResponse.json(
        { error: "Private Shot Tracker access is required." },
        { status: 403, headers },
      );
    const parsed = (
      write ? reportRequestSchema : z.object({ eventId: z.uuid() }).strict()
    ).safeParse(
      write
        ? await request.json().catch(() => null)
        : Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid report selection." },
        { status: 400, headers },
      );
    const event = await loadReportEvent(account, parsed.data.eventId);
    if (write) {
      const input = reportRequestSchema.parse(parsed.data);
      return NextResponse.json(
        { packet: await generateEventReports(account, event, input.audience) },
        { headers },
      );
    }
    return NextResponse.json(await getEventReports(account, event), {
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ReportError
            ? error.message
            : "Private reports are unavailable. Refresh and check your event access.",
      },
      { status: error instanceof ReportError ? error.status : 503, headers },
    );
  }
}
export function GET(request: Request) {
  return handle(request, false);
}
export function POST(request: Request) {
  return handle(request, true);
}
