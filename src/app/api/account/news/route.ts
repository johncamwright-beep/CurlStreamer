import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validateSponsorImage } from "@/lib/providers/sponsor-library";
import {
  legacyNewsContent,
  newsContentSchema,
  newsPlainText,
} from "@/lib/news-content";
const headers = { "Cache-Control": "private, no-store" };
const inputSchema = z.object({
  id: z.uuid(),
  revision: z.coerce.number().int().min(0),
  gameId: z.uuid().nullable(),
  summary: z.string().trim().min(1).max(3000),
  content: z.string().max(40000).optional(),
  published: z.enum(["true", "false"]).transform((v) => v === "true"),
  removePhoto: z.enum(["true", "false"]).transform((v) => v === "true"),
});
export async function GET(request: Request) {
  try {
    const auth = await teamSettingsContext(true);
    if (!auth)
      return NextResponse.json(
        { error: "Team administrator access is required." },
        { status: 403, headers },
      );
    const id = new URL(request.url).searchParams.get("id");
    if (id && !z.uuid().safeParse(id).success)
      return NextResponse.json(
        { error: "Invalid post." },
        { status: 400, headers },
      );
    let query = createAdminSupabaseClient()
      .from("team_news")
      .select(
        "id,summary,content,photo_url,published,created_at,revision,game_id",
      )
      .eq("organization_id", auth.organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(id ? 1 : 100);
    if (id) query = query.eq("id", id);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ posts: data }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Team news could not be loaded." },
      { status: 503, headers },
    );
  }
}
async function write(request: Request, editing: boolean) {
  let phase = "validation";
  let path: string | undefined;
  let submitted = false;
  let db: ReturnType<typeof createAdminSupabaseClient> | undefined;
  try {
    const auth = await teamSettingsContext(true);
    if (!auth)
      return NextResponse.json(
        { error: "Team administrator access is required." },
        { status: 403, headers },
      );
    const form = await request.formData();
    const input = inputSchema.parse({
      id: form.get("id") ?? randomUUID(),
      revision: form.get("revision") ?? 0,
      gameId: form.get("gameId") || null,
      summary: form.get("summary"),
      content: form.get("content")?.toString(),
      published: form.get("published") ?? "false",
      removePhoto: form.get("removePhoto") ?? "false",
    });
    if (editing ? input.revision < 1 : input.revision !== 0)
      throw Error("Invalid revision");
    const content = input.content
      ? newsContentSchema.parse(JSON.parse(input.content))
      : legacyNewsContent(input.summary);
    const summary = input.content ? newsPlainText(content) : input.summary;
    if (!summary) throw Error("News content needs text.");
    db = createAdminSupabaseClient();
    let photo: string | null = null;
    const file = form.get("photo");
    if (file instanceof File && file.size) {
      phase = "image";
      const image = await validateSponsorImage(file);
      path = auth.organizationId + "/" + randomUUID() + "." + image.extension;
      const { error } = await db.storage
        .from("team-public-media")
        .upload(path, image.bytes, { contentType: image.mime });
      if (error)
        throw Error(
          "The cover photo could not be uploaded. Please try saving without the cover photo.",
        );
      photo = db.storage.from("team-public-media").getPublicUrl(path)
        .data.publicUrl;
    }
    submitted = true;
    phase = "save";
    const { data, error } = await db.rpc("manage_team_news", {
      p_org: auth.organizationId,
      p_user: auth.user.id,
      p_id: input.id,
      p_revision: input.revision,
      p_summary: summary,
      p_photo: photo,
      p_replace_photo: !!photo || input.removePhoto,
      p_published: input.published,
      p_game: input.gameId,
      p_delete: false,
      p_content: content,
    });
    if (error) {
      // A transport failure may arrive after commit. Keep that image available.
      if (path && /^[0-9A-Z]{5}$/.test(error.code))
        await db.storage.from("team-public-media").remove([path]);
      path = undefined;
      return NextResponse.json(
        {
          error:
            error.code === "40001"
              ? "This post changed or is no longer available. Reload team news before editing it again."
              : "News could not be saved. A game summary must belong to a completed team game.",
        },
        { status: error.code === "40001" ? 409 : 400, headers },
      );
    }
    if (path && data.photo_url !== photo)
      await db.storage.from("team-public-media").remove([path]);
    return NextResponse.json({ saved: true, post: data }, { headers });
  } catch (cause) {
    if (path && db && !submitted)
      await db.storage.from("team-public-media").remove([path]);
    return NextResponse.json(
      {
        error:
          cause instanceof z.ZodError
            ? "The post contains unsupported formatting. " +
              cause.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .slice(0, 2)
                .join("; ")
            : phase === "image" && cause instanceof Error
              ? cause.message
              : "News could not be saved. Please try again. Your changes are still in the editor.",
      },
      { status: 400, headers },
    );
  }
}
export const POST = (request: Request) => write(request, false);
export const PATCH = (request: Request) => write(request, true);
export async function DELETE(request: Request) {
  try {
    const auth = await teamSettingsContext(true);
    if (!auth)
      return NextResponse.json(
        { error: "Team administrator access is required." },
        { status: 403, headers },
      );
    const input = z
      .object({ id: z.uuid(), revision: z.number().int().min(1) })
      .strict()
      .parse(await request.json());
    const { error } = await createAdminSupabaseClient().rpc(
      "manage_team_news",
      {
        p_org: auth.organizationId,
        p_user: auth.user.id,
        p_id: input.id,
        p_revision: input.revision,
        p_summary: "",
        p_photo: null,
        p_replace_photo: false,
        p_published: false,
        p_delete: true,
      },
    );
    if (error)
      return NextResponse.json(
        {
          error:
            "This post changed or is no longer available. Reload team news.",
        },
        { status: 409, headers },
      );
    return NextResponse.json({ removed: true }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Post could not be removed." },
      { status: 400, headers },
    );
  }
}
