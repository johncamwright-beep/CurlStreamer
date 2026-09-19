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
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { loadProductionStreamerEvent } from "@/lib/providers/curlcoach-production-streamer";
import {
  loadCoachState,
  saveCoachState,
  transitionCoachState,
} from "@/lib/providers/curlcoach-store";
const selection = z
  .object({
    source: z.enum(["sample", "streamer"]).default("sample"),
    eventId: z.string().min(1).max(100).optional(),
  })
  .strict();
const privateHeaders = { "Cache-Control": "private, no-store" };
async function denial() {
  if (!labEnabled()) {
    if (process.env.CURLCOACH_ENABLED !== "true")
      return new NextResponse(null, { status: 404 });
    if (!(await requireCoachAccount()))
      return NextResponse.json(
        { error: "Private coaching access is required." },
        { status: 403, headers: privateHeaders },
      );
    return;
  }
  if (!(await authorized((await cookies()).get(sessionCookie)?.value)))
    return NextResponse.json(
      { error: "Unlock the local coach lab." },
      { status: 401 },
    );
}
async function source(input: z.infer<typeof selection>, gameId?: string) {
  if (!labEnabled()) {
    if (input.source !== "streamer")
      throw new Error("Sample data is only available in the local lab.");
    return gameId
      ? loadProductionStreamerEvent(input.eventId, gameId)
      : loadProductionStreamerEvent(input.eventId);
  }
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
    const { event, catalog, actor } = await source(input.data);
    event.games = await Promise.all(
      event.games.map(async (game) => ({
        ...game,
        state: labEnabled()
          ? readCoachState(game.state)
          : await loadCoachState(
              {
                organizationId: event.organizationId,
                gameId: game.id,
                actorUserId: actor,
              },
              game.state,
            ),
      })),
    );
    return NextResponse.json(
      { event, catalog, refreshedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          labEnabled() && error instanceof Error
            ? error.message
            : "Private coaching is unavailable. Check your access and team event settings.",
      },
      { status: 503, headers: privateHeaders },
    );
  }
}
export async function POST(request: Request) {
  const denied = await denial();
  if (denied) return denied;
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const input = selection
    .extend({
      gameId: z.string().min(1).max(100),
      command: commandSchema.optional(),
      action: z.enum(["finish", "reopen"]).optional(),
      requestId: z.uuid().optional(),
      expectedRevision: z.number().int().nonnegative().optional(),
    })
    .refine((value) =>
      value.command
        ? !value.action &&
          !value.requestId &&
          value.expectedRevision === undefined
        : !!value.action &&
          !!value.requestId &&
          value.expectedRevision !== undefined,
    )
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid coaching request" },
      { status: 400 },
    );
  try {
    const { event, actor } = await source(input.data, input.data.gameId);
    const game = event.games.find((game) => game.id === input.data.gameId);
    if (!game)
      return NextResponse.json(
        { error: "Game does not belong to the selected event" },
        { status: 403 },
      );
    let result;
    if (labEnabled()) {
      if (!input.data.command)
        return NextResponse.json(
          { error: "Private lifecycle requires a connected account." },
          { status: 400 },
        );
      result = writeCoachEvent(input.data.command, game.state, actor);
    } else {
      const scope = {
        organizationId: event.organizationId,
        gameId: game.id,
        actorUserId: actor,
      };
      const state = await loadCoachState(scope, game.state);
      result = input.data.command
        ? await saveCoachState(scope, state, input.data.command)
        : await transitionCoachState(
            scope,
            state,
            input.data.action!,
            input.data.requestId!,
            input.data.expectedRevision!,
          );
    }
    return NextResponse.json(result, { headers: privateHeaders });
  } catch {
    return NextResponse.json(
      {
        error:
          "Save unavailable or revision conflict. Refresh the event before retrying.",
      },
      { status: 409, headers: privateHeaders },
    );
  }
}
