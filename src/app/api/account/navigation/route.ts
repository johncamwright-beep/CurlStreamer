import { NextResponse } from "next/server";
import { platformAdminContext } from "@/lib/providers/platform-admin";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return NextResponse.json(
      { platformAdmin: Boolean(await platformAdminContext()) },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { platformAdmin: false },
      { status: 503, headers },
    );
  }
}
