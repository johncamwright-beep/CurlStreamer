import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorized,
  labEnabled,
  sameOrigin,
  sessionCookie,
} from "@/lib/curlcoach/access";
import { commandSchema } from "@/lib/curlcoach/model";
import { sampleCatalog, sampleEvent } from "@/lib/curlcoach/event";
import {
  readCoachState,
  writeCoachEvent,
} from "@/lib/providers/curlcoach-local";
import { loadStreamerEvent } from "@/lib/providers/curlcoach-streamer";
const selection = z
  .object({
    source: z.enum(["sample", "streamer"]).default("sample"),
    eventId: z.string().min(1).max(100).optional(),
  })
  .strict();
async function denial() {
  if (!labEnabled()) return new NextResponse(null, { status: 404 });
  if (!(await authorized((await cookies()).get(sessionCookie)?.value)))
    return NextResponse.json(
      { error: "Unlock the local coach lab." },
      { status: 401 },
    );
}
async function source(input: z.infer<typeof selection>) {
  return input.source === "sample"
    ? {
        event: sampleEvent(input.eventId ?? "practice"),
        catalog: sampleCatalog,
        actor: "synthetic-coach",
      }
    : loadStreamerEvent(input.eventId);
}
export async function GET(request: Request) {
  const denied = await denial();
  if (denied) return denied;
  const input = selection.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid event selection" },
      { status: 400 },
    );
  try {
    const { event, catalog } = await source(input.data);
    event.games = event.games.map((game) => ({
      ...game,
      state: readCoachState(game.state),
    }));
    return NextResponse.json(
      { event, catalog, refreshedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Event unavailable" },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const denied = await denial();
  if (denied) return denied;
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const input = selection
    .extend({ gameId: z.string().min(1).max(100), command: commandSchema })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid shot request" },
      { status: 400 },
    );
  try {
    const { event, actor } = await source(input.data);
    const game = event.games.find((game) => game.id === input.data.gameId);
    if (!game)
      return NextResponse.json(
        { error: "Game does not belong to the selected event" },
        { status: 403 },
      );
    return NextResponse.json(
      writeCoachEvent(input.data.command, game.state, actor),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Save unavailable or revision conflict. Refresh the event before retrying.",
      },
      { status: 409 },
    );
  }
}
