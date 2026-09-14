import { NextResponse } from "next/server";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
export async function GET() {
  let enabled = false;
  if (process.env.CURLCOACH_ENABLED === "true") {
    try {
      enabled = Boolean(await requireCoachAccount());
    } catch {
      enabled = false;
    }
  }
  return NextResponse.json(
    { enabled },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
