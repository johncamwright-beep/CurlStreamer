import { NextResponse } from "next/server";
import { sameOrigin, labEnabled } from "@/lib/curlcoach/access";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { ReportError } from "@/lib/providers/shot-tracker-reports";
import {
  emailSelection,
  emailRequest,
  prepareReportEmail,
  sendReportEmail,
} from "@/lib/providers/shot-tracker-report-email";
export const runtime = "nodejs";
export const maxDuration = 120;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function handle(request: Request, write: boolean) {
  if (process.env.CURLCOACH_ENABLED !== "true" || labEnabled())
    return new NextResponse(null, { status: 404 });
  if (write && !sameOrigin(request))
    return reply({ error: "Open the report on this website." }, 403);
  try {
    const account = await requireCoachAccount();
    if (!account)
      return reply({ error: "Private Shot Tracker access required." }, 403);
    if (write) {
      const input = emailRequest.safeParse(
        await request.json().catch(() => null),
      );
      if (!input.success)
        return reply({ error: "Invalid report email selection." }, 400);
      return reply(await sendReportEmail(account, input.data));
    }
    const input = emailSelection.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!input.success)
      return reply({ error: "Invalid report email selection." }, 400);
    return reply((await prepareReportEmail(account, input.data)).preview);
  } catch (e) {
    return reply(
      {
        error:
          e instanceof ReportError
            ? e.message
            : "Report email is temporarily unavailable.",
      },
      e instanceof ReportError ? e.status : 503,
    );
  }
}
export function GET(request: Request) {
  return handle(request, false);
}
export function POST(request: Request) {
  return handle(request, true);
}
