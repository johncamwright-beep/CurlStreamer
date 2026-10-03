import { headers } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readPublishedTeamProfile } from "@/lib/providers/public-team-profile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SOURCE_BYTES = 1024 * 1024;

async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxBytes) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function renderIcon(input: Buffer) {
  return sharp(input, { limitInputPixels: 20000000 })
    .resize(96, 96, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
}

export async function GET() {
  const host = (await headers()).get("host")?.toLowerCase().split(":")[0] ?? "";
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.curlstreamer\.app$/.exec(host);
  if (!match || match[1] === "www") return new Response(null, { status: 404 });
  const profile = await readPublishedTeamProfile(match[1]);
  if (!profile) return new Response(null, { status: 404 });
  const fallback = await readFile(
    path.join(process.cwd(), "public/branding/curlstreamer-icon.png"),
  );
  let input = fallback;
  if (profile.logo_url) {
    try {
      const url = new URL(profile.logo_url),
        origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
      if (
        url.origin === origin &&
        url.pathname.startsWith("/storage/v1/object/public/team-public-media/")
      ) {
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        });
        if (response.ok) {
          const bytes = await readResponseBytes(response, MAX_SOURCE_BYTES);
          if (bytes) {
            try {
              await sharp(bytes, { limitInputPixels: 20000000 }).metadata();
              input = bytes as typeof input;
            } catch {
              /* Keep the branded fallback when an upload is not an image. */
            }
          }
        }
      }
    } catch {
      /* A missing team upload still has a branded fallback. */
    }
  }
  try {
    const png = await renderIcon(input).catch(() => renderIcon(fallback));
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
