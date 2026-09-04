import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadActiveTeam } from "@/lib/team-games";
import {
  createSponsors,
  listSponsorLibrary,
  reorderSponsors,
  replaceSponsor,
  updateSponsor,
} from "@/lib/providers/sponsor-library";

export const dynamic = "force-dynamic";
const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    altText: z.string().trim().min(1).max(240),
    archived: z.boolean(),
  }),
  z.object({
    action: z.literal("reorder"),
    ids: z.array(z.uuid()).max(500),
  }),
]);

async function context(write: boolean) {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user) return null;
  const team = await loadActiveTeam(user);
  if (
    team.kind !== "ready" ||
    team.team.role === "viewer" ||
    (write && !["owner", "team_admin"].includes(team.team.role))
  )
    return null;
  return { user, team: team.team };
}

export async function GET() {
  const auth = await context(false);
  if (!auth)
    return NextResponse.json(
      { error: "Sponsor access is required" },
      { status: 403 },
    );
  try {
    return NextResponse.json({
      sponsors: await listSponsorLibrary(auth.user),
      role: auth.team.role,
    });
  } catch {
    return NextResponse.json(
      { error: "Sponsor library is temporarily unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await context(true);
  if (!auth)
    return NextResponse.json(
      { error: "Team administrator access is required" },
      { status: 403 },
    );
  try {
    const form = await request.formData();
    const files = form
      .getAll("file")
      .filter((value): value is File => value instanceof File);
    const metadata = z
      .array(
        z.object({
          id: z.uuid().optional(),
          name: z.string().trim().min(1).max(100),
          altText: z.string().trim().min(1).max(240),
        }),
      )
      .min(1)
      .max(20)
      .parse(JSON.parse(String(form.get("metadata"))));
    if (files.length !== metadata.length)
      throw new Error("Invalid upload batch");
    const sponsors = await createSponsors(
      auth.user,
      auth.team.organizationId,
      files.map((file, index) => ({ file, ...metadata[index] })),
    );
    return NextResponse.json({ sponsors }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid sponsor upload",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await context(true);
  if (!auth)
    return NextResponse.json(
      { error: "Team administrator access is required" },
      { status: 403 },
    );
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid sponsor update" },
      { status: 400 },
    );
  try {
    const sponsors =
      parsed.data.action === "reorder"
        ? await reorderSponsors(auth.user, parsed.data.ids)
        : await updateSponsor(auth.user, parsed.data);
    return NextResponse.json({ sponsors });
  } catch {
    return NextResponse.json(
      { error: "Sponsor update failed" },
      { status: 409 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await context(true);
  if (!auth)
    return NextResponse.json(
      { error: "Team administrator access is required" },
      { status: 403 },
    );
  try {
    const form = await request.formData();
    const id = z.uuid().parse(form.get("id"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Replacement image required");
    return NextResponse.json({
      sponsors: await replaceSponsor(
        auth.user,
        auth.team.organizationId,
        id,
        file,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Replacement failed" },
      { status: 400 },
    );
  }
}
