import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validateSponsorImage } from "@/lib/providers/sponsor-library";
export async function POST(request: Request) {
  const auth = await teamSettingsContext(true);
  if (!auth)
    return NextResponse.json(
      { error: "Sign in as a team administrator to post a summary." },
      { status: 403 },
    );
  const db = createAdminSupabaseClient();
  let path: string | undefined;
  try {
    const form = await request.formData();
    const input = z
      .object({
        gameId: z.uuid(),
        summary: z.string().trim().min(1).max(3000),
        published: z.boolean(),
      })
      .parse({
        gameId: form.get("gameId"),
        summary: form.get("summary"),
        published: form.get("published") === "true",
      });
    const file = form.get("photo");
    let photo: string | null = null;
    if (file instanceof File && file.size) {
      const image = await validateSponsorImage(file);
      path = auth.organizationId + "/" + randomUUID() + "." + image.extension;
      const { error } = await db.storage
        .from("team-public-media")
        .upload(path, image.bytes, { contentType: image.mime });
      if (error) throw error;
      photo = db.storage.from("team-public-media").getPublicUrl(path)
        .data.publicUrl;
    }
    const { error } = await db.rpc("save_team_game_news", {
      p_org: auth.organizationId,
      p_user: auth.user.id,
      p_game: input.gameId,
      p_summary: input.summary,
      p_photo: photo,
      p_published: input.published,
    });
    if (error) throw error;
    return NextResponse.json({ saved: true });
  } catch {
    if (path) await db.storage.from("team-public-media").remove([path]);
    return NextResponse.json(
      {
        error:
          "Summary could not be saved. Check that this is a completed team game and any photo is under 4 MB.",
      },
      { status: 400 },
    );
  }
}
