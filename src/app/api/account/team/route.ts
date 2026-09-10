import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  teamSettingsContext,
  readTeamSettings,
} from "@/lib/providers/team-settings";
import { teamPageSettingsSchema } from "@/lib/team-page-settings";
import { validateSponsorImage } from "@/lib/providers/sponsor-library";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    const auth = await teamSettingsContext();
    if (!auth)
      return NextResponse.json(
        { error: "Sign in to your team account." },
        { status: 403, headers },
      );
    return NextResponse.json(
      {
        ...(await readTeamSettings(auth.organizationId)),
        canEdit: ["owner", "team_admin"].includes(auth.role),
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Team settings are temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
export async function PATCH(request: Request) {
  try {
    const auth = await teamSettingsContext(true);
    if (!auth)
      return NextResponse.json(
        { error: "Team administrator access is required." },
        { status: 403 },
      );
    const parsed = teamPageSettingsSchema.safeParse(await request.json());
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Check the team details." },
        { status: 400 },
      );
    const { error } = await createAdminSupabaseClient().rpc(
      "update_team_public_profile",
      { p_org: auth.organizationId, p_settings: parsed.data },
    );
    if (error)
      return NextResponse.json(
        {
          error:
            error.code === "23505"
              ? "That team address is already taken."
              : "Team settings could not be saved.",
        },
        { status: error.code === "23505" ? 409 : 503 },
      );
    return NextResponse.json({ saved: true }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Team settings could not be saved." },
      { status: 400 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const auth = await teamSettingsContext(true);
    if (!auth)
      return NextResponse.json(
        { error: "Team administrator access is required." },
        { status: 403 },
      );
    const file = (await request.formData()).get("file");
    if (!(file instanceof File))
      return NextResponse.json(
        { error: "Choose a team logo." },
        { status: 400 },
      );
    const image = await validateSponsorImage(file);
    const db = createAdminSupabaseClient();
    const current = await readTeamSettings(auth.organizationId);
    const { error: saveError } = await db.rpc("update_team_public_profile", {
      p_org: auth.organizationId,
      p_settings: current.settings,
    });
    if (saveError)
      throw Error("Save your team details before uploading a logo.");
    const path =
      auth.organizationId + "/" + randomUUID() + "." + image.extension;
    const { error } = await db.storage
      .from("team-public-media")
      .upload(path, image.bytes, { contentType: image.mime });
    if (error) throw Error("Logo upload failed.");
    const logo = db.storage.from("team-public-media").getPublicUrl(path)
      .data.publicUrl;
    const updated = await db
      .from("team_public_profiles")
      .update({ logo_url: logo })
      .eq("organization_id", auth.organizationId);
    if (updated.error) {
      await db.storage.from("team-public-media").remove([path]);
      throw Error("Logo could not be saved.");
    }
    return NextResponse.json({ logo }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Use a PNG, JPEG or WebP image up to 4 MB. Save your team details first.",
      },
      { status: 400 },
    );
  }
}
