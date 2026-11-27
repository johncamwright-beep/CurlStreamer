import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validateSponsorImage } from "@/lib/providers/sponsor-library";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  try {
    const auth = await teamSettingsContext(true);
    if (!auth)
      return NextResponse.json(
        { error: "Team administrator access is required." },
        { status: 403, headers },
      );
    const file = (await request.formData()).get("image");
    if (!(file instanceof File) || !file.size) throw Error("Missing image");
    const image = await validateSponsorImage(file);
    const path = `${auth.organizationId}/news/${randomUUID()}.${image.extension}`;
    const db = createAdminSupabaseClient();
    const { error } = await db.storage
      .from("team-public-media")
      .upload(path, image.bytes, { contentType: image.mime });
    if (error) throw error;
    return NextResponse.json(
      {
        url: db.storage.from("team-public-media").getPublicUrl(path).data
          .publicUrl,
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Upload a PNG, JPEG or WebP photo under 4 MB." },
      { status: 400, headers },
    );
  }
}
