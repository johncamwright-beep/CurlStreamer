import "server-only";
import sharp from "sharp";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const MAX_BYTES = 4 * 1024 * 1024;
const mediaSchema = z.object({
  logo_url: z.string().nullable(),
  settings: z.object({ photo: z.string().optional() }),
});

async function boundedBytes(response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/** Only fetch uploads belonging to the organization already authorized by the caller. */
export async function prepareThumbnailImage(
  source: string | null | undefined,
  organizationId: string,
  size: { width: number; height: number },
  fetcher: typeof fetch = fetch,
) {
  if (!source) return undefined;
  try {
    z.uuid().parse(organizationId);
    const url = new URL(source);
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
    const prefix = `/storage/v1/object/public/team-public-media/${organizationId}/`;
    if (
      url.protocol !== "https:" ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(prefix) ||
      !/^[a-f0-9-]+\.(png|jpg|jpeg|webp)$/.test(
        url.pathname.slice(prefix.length),
      )
    )
      return undefined;
    const response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (
      !response.ok ||
      !/^image\/(png|jpeg|webp)(;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      return undefined;
    const bytes = await boundedBytes(response);
    if (!bytes) return undefined;
    const png = await sharp(bytes, { limitInputPixels: 20_000_000 })
      .rotate()
      .resize(size.width, size.height, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function loadScheduledThumbnailMedia(organizationId: string) {
  try {
    z.uuid().parse(organizationId);
    const { data, error } = await createAdminSupabaseClient()
      .from("team_public_profiles")
      .select("logo_url,settings")
      .eq("organization_id", organizationId)
      .maybeSingle();
    const profile = mediaSchema.safeParse(data);
    if (error || !profile.success) return {};
    const [teamLogo, teamPhoto] = await Promise.all([
      prepareThumbnailImage(profile.data.logo_url, organizationId, {
        width: 300,
        height: 200,
      }),
      prepareThumbnailImage(profile.data.settings.photo, organizationId, {
        width: 600,
        height: 500,
      }),
    ]);
    return {
      ...(teamLogo ? { teamLogo } : {}),
      ...(teamPhoto ? { teamPhoto } : {}),
    };
  } catch {
    return {};
  }
}
