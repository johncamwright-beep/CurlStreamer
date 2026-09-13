import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  platformAdminContext,
  sameOriginWrite,
} from "@/lib/providers/platform-admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readTeamSettings } from "@/lib/providers/team-settings";
import { teamPageSettingsSchema } from "@/lib/team-page-settings";
import { validateSponsorImage } from "@/lib/providers/sponsor-library";
type Context = { params: Promise<{ id: string }> };
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function authority(context: Context) {
  const user = await platformAdminContext();
  const org = z.uuid().parse((await context.params).id);
  if (!user) throw Error("forbidden");
  return { user, org, db: createAdminSupabaseClient() };
}
export async function GET(_: Request, context: Context) {
  try {
    const { user, org, db } = await authority(context);
    const { error } = await db.rpc("platform_manage_account", {
      p_user: user.id,
      p_action: "view",
      p_target: org,
    });
    if (error) throw error;
    return reply({ ...(await readTeamSettings(org)), canEdit: true });
  } catch {
    return reply(
      {
        error:
          "Platform administrator access is required, or this team is unavailable.",
      },
      403,
    );
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open the support view on this website." }, 403);
    const { user, org, db } = await authority(context);
    const parsed = teamPageSettingsSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return reply({ error: "Check the team settings." }, 400);
    const prefix = db.storage.from("team-public-media").getPublicUrl(org + "/")
      .data.publicUrl;
    for (const url of [
      parsed.data.photo,
      ...parsed.data.gallery.map((item) => item.url),
    ].filter(Boolean)) {
      if (
        !url.startsWith(prefix) ||
        !/^[a-f0-9-]+\.(png|jpg|jpeg|webp)$/.test(url.slice(prefix.length))
      )
        return reply({ error: "Use images uploaded to this team." }, 400);
    }
    const { error } = await db.rpc("platform_update_team", {
      p_user: user.id,
      p_org: org,
      p_settings: parsed.data,
      p_publish: request.headers.get("X-Team-Publish") === "confirm",
    });
    if (error)
      return reply(
        {
          error:
            "Settings could not be saved. Published team addresses remain permanent.",
        },
        409,
      );
    return reply({ saved: true, settings: parsed.data });
  } catch {
    return reply({ error: "The support edit could not be saved." }, 403);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open the support view on this website." }, 403);
    const { user, org, db } = await authority(context),
      form = await request.formData();
    const kind = z
      .enum(["logo", "photo", "gallery"])
      .parse(form.get("kind") ?? "logo");
    const file = form.get("file");
    if (!(file instanceof File))
      return reply({ error: "Choose an image." }, 400);
    const image = await validateSponsorImage(file),
      current = await readTeamSettings(org);
    if (kind === "gallery" && current.settings.gallery.length >= 50)
      return reply({ error: "Photo limit reached." }, 409);
    const path = org + "/" + randomUUID() + "." + image.extension;
    const uploaded = await db.storage
      .from("team-public-media")
      .upload(path, image.bytes, { contentType: image.mime });
    if (uploaded.error) throw uploaded.error;
    const url = db.storage.from("team-public-media").getPublicUrl(path)
      .data.publicUrl;
    const gallery = [
      ...current.settings.gallery,
      { id: randomUUID(), url, caption: "" },
    ];
    const settings =
      kind === "photo"
        ? { ...current.settings, photo: url }
        : kind === "gallery"
          ? { ...current.settings, gallery }
          : current.settings;
    const { error } = await db.rpc("platform_update_team", {
      p_user: user.id,
      p_org: org,
      p_settings: settings,
      ...(kind === "logo" ? { p_logo: url } : {}),
    });
    if (error) {
      await db.storage.from("team-public-media").remove([path]);
      throw error;
    }
    return reply(
      kind === "logo"
        ? { logo: url }
        : kind === "photo"
          ? { photo: url }
          : { gallery },
    );
  } catch {
    return reply({ error: "The team image could not be saved." }, 400);
  }
}
