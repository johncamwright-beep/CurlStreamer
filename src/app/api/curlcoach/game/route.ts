import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  authorized,
  labEnabled,
  sameOrigin,
  sessionCookie,
} from "@/lib/curlcoach/access";
import { commandSchema } from "@/lib/curlcoach/model";
import {
  readCoachState,
  writeCoachEvent,
} from "@/lib/providers/curlcoach-local";

async function denial() {
  if (!labEnabled()) return new NextResponse(null, { status: 404 });
  if (!(await authorized((await cookies()).get(sessionCookie)?.value)))
    return NextResponse.json(
      { error: "Unlock the local coach lab." },
      { status: 401 },
    );
}
export async function GET() {
  const denied = await denial();
  if (denied) return denied;
  try {
    return NextResponse.json(readCoachState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Local data could not be read. No records were reset." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const denied = await denial();
  if (denied) return denied;
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const input = commandSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: input.error.issues[0]?.message ?? "Invalid attempt" },
      { status: 400 },
    );
  try {
    return NextResponse.json(writeCoachEvent(input.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Save conflict or local storage unavailable. Reload and check the attempt before retrying.",
      },
      { status: 409 },
    );
  }
}
