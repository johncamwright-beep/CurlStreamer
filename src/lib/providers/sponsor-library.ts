import "server-only";
import { randomUUID } from "crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { LibrarySponsor, Sponsor } from "@/lib/types";

const BUCKET = "organization-sponsors";
const SIGNED_URL_SECONDS = 12 * 60 * 60;
const PUBLIC_BROADCAST_URL_SECONDS = 5 * 60;
const PUBLIC_BROADCAST_CACHE_MS = 4 * 60 * 1000;
// Keep multipart requests below Vercel's 4.5 MB function payload boundary.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
type SponsorRow = {
  id: string;
  display_name: string;
  alt_text: string;
  storage_path: string;
  position: number;
  archived_at?: string | null;
};
type BroadcastSponsorCacheEntry = {
  stateKey: string;
  expiresAt: number;
  sponsors: Sponsor[];
};
const broadcastSponsorCache = new Map<string, BroadcastSponsorCacheEntry>();

function broadcastSponsorStateKey(rows: SponsorRow[]) {
  return JSON.stringify(
    rows.map((row) => [
      row.id,
      row.display_name,
      row.alt_text,
      row.storage_path,
      row.position,
      row.archived_at ?? null,
    ]),
  );
}

async function presentOne(
  row: SponsorRow,
  signedUrlSeconds: number,
): Promise<LibrarySponsor> {
  const db = createAdminSupabaseClient();
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, signedUrlSeconds);
  if (error || !data?.signedUrl) throw new Error("Sponsor preview unavailable");
  return {
    id: row.id,
    name: row.display_name,
    altText: row.alt_text,
    imageUrl: data.signedUrl,
    archived: Boolean(row.archived_at),
    position: row.position,
  };
}

async function present(
  rows: SponsorRow[],
  signedUrlSeconds = SIGNED_URL_SECONDS,
): Promise<LibrarySponsor[]> {
  return Promise.all(rows.map((row) => presentOne(row, signedUrlSeconds)));
}

async function presentAvailable(
  rows: SponsorRow[],
  signedUrlSeconds: number,
): Promise<{ sponsors: LibrarySponsor[]; complete: boolean }> {
  const results = await Promise.allSettled(
    rows.map((row) => presentOne(row, signedUrlSeconds)),
  );
  const sponsors = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (rows.length && !sponsors.length)
    throw new Error("Sponsor preview unavailable");
  return {
    sponsors,
    complete: results.every((result) => result.status === "fulfilled"),
  };
}

export async function listSponsorLibrary(user: User) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "list_organization_sponsors",
    { p_user_id: user.id },
  );
  if (error) throw new Error("Sponsor library unavailable");
  return present((data ?? []) as SponsorRow[]);
}

export async function gameLibrarySponsors(
  gameId: string,
  verifiedOrganizationId?: string,
): Promise<Sponsor[]> {
  const { data, error } = await createAdminSupabaseClient().rpc(
    verifiedOrganizationId
      ? "list_sponsors_for_organization"
      : "list_game_organization_sponsors",
    verifiedOrganizationId
      ? { p_organization_id: verifiedOrganizationId }
      : { p_game_id: gameId },
  );
  if (error) throw new Error("Sponsor library unavailable");
  const rows = ((data ?? []) as SponsorRow[]).filter((row) => !row.archived_at);
  const { sponsors } = await presentAvailable(rows, SIGNED_URL_SECONDS);
  return sponsors.map((s) => ({
    id: s.id,
    name: s.name,
    altText: s.altText,
    dataUrl: s.imageUrl,
    enabled: true,
    rotation: 0,
  }));
}

/** Public Broadcast receives renderable URLs, never the underlying storage path. */
export async function gameBroadcastSponsors(
  gameId: string,
): Promise<Sponsor[]> {
  if (process.env.NODE_ENV !== "production") return [];
  const { data, error } = await createAdminSupabaseClient().rpc(
    "list_game_organization_sponsors",
    { p_game_id: gameId },
  );
  if (error) throw new Error("Sponsor library unavailable");
  const rows = ((data ?? []) as SponsorRow[]).filter((row) => !row.archived_at);
  const stateKey = broadcastSponsorStateKey(rows);
  const cached = broadcastSponsorCache.get(gameId);
  if (cached && cached.stateKey === stateKey && cached.expiresAt > Date.now())
    return cached.sponsors;
  const presented = await presentAvailable(rows, PUBLIC_BROADCAST_URL_SECONDS);
  const sponsors = presented.sponsors.map((sponsor) => ({
    id: sponsor.id,
    name: sponsor.name,
    altText: sponsor.altText,
    dataUrl: sponsor.imageUrl,
    enabled: true,
    rotation: 0,
  }));
  if (presented.complete)
    broadcastSponsorCache.set(gameId, {
      stateKey,
      expiresAt: Date.now() + PUBLIC_BROADCAST_CACHE_MS,
      sponsors,
    });
  return sponsors;
}

export type ValidImage = { bytes: Uint8Array; mime: string; extension: string };
export function validateSponsorImage(file: File): Promise<ValidImage> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
      throw new Error(`${file.name}: images must be no larger than 4 MB.`);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png =
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
    const webp =
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
    const detected = jpeg
      ? ["image/jpeg", "jpg"]
      : png
        ? ["image/png", "png"]
        : webp
          ? ["image/webp", "webp"]
          : null;
    const acceptedBrowserTypes: Record<string, string[]> = {
      "image/jpeg": ["", "image/jpeg", "image/jpg", "image/pjpeg"],
      "image/png": ["", "image/png", "image/x-png"],
      "image/webp": ["", "image/webp"],
    };
    if (
      !detected ||
      !acceptedBrowserTypes[detected[0]].includes(file.type.toLowerCase())
    )
      throw new Error(
        `${file.name}: file contents are not a supported JPEG, PNG, or WebP image.`,
      );
    return { bytes, mime: detected[0], extension: detected[1] };
  });
}

export async function createSponsors(
  user: User,
  organizationId: string,
  inputs: { file: File; name: string; altText: string; id?: string }[],
) {
  // Validation is deliberately complete before the first storage/database write.
  const validated = await Promise.all(
    inputs.map(async (input) => ({
      ...input,
      image: await validateSponsorImage(input.file),
    })),
  );
  const db = createAdminSupabaseClient();
  const created: { id: string; path: string }[] = [];
  try {
    for (const input of validated) {
      const id = input.id ?? randomUUID();
      const path = `${organizationId}/${id}.${input.image.extension}`;
      const uploaded = await db.storage
        .from(BUCKET)
        .upload(path, input.image.bytes, {
          contentType: input.image.mime,
          upsert: false,
        });
      if (uploaded.error) throw new Error("Sponsor upload failed");
      const { error } = await db.rpc("create_organization_sponsor", {
        p_user_id: user.id,
        p_id: id,
        p_name: input.name,
        p_alt: input.altText,
        p_path: path,
        p_mime: input.image.mime,
        p_size: input.image.bytes.length,
      });
      if (error) {
        await db.storage.from(BUCKET).remove([path]);
        throw new Error("Sponsor upload failed");
      }
      created.push({ id, path });
    }
  } catch (error) {
    for (const item of created.reverse()) {
      await db.rpc("rollback_organization_sponsor", {
        p_user_id: user.id,
        p_id: item.id,
      });
      await db.storage.from(BUCKET).remove([item.path]);
    }
    throw error;
  }
  return listSponsorLibrary(user);
}

export async function updateSponsor(
  user: User,
  input: { id: string; name: string; altText: string; archived: boolean },
) {
  const { error } = await createAdminSupabaseClient().rpc(
    "update_organization_sponsor",
    {
      p_user_id: user.id,
      p_id: input.id,
      p_name: input.name,
      p_alt: input.altText,
      p_archived: input.archived,
    },
  );
  if (error) throw new Error("Sponsor update failed");
  return listSponsorLibrary(user);
}

export async function reorderSponsors(user: User, ids: string[]) {
  const { error } = await createAdminSupabaseClient().rpc(
    "reorder_organization_sponsors",
    { p_user_id: user.id, p_ids: ids },
  );
  if (error) throw new Error("Sponsor reorder failed");
  return listSponsorLibrary(user);
}

export async function replaceSponsor(
  user: User,
  organizationId: string,
  id: string,
  file: File,
) {
  const image = await validateSponsorImage(file);
  const path = `${organizationId}/${randomUUID()}.${image.extension}`;
  const db = createAdminSupabaseClient();
  const uploaded = await db.storage.from(BUCKET).upload(path, image.bytes, {
    contentType: image.mime,
    upsert: false,
  });
  if (uploaded.error) throw new Error("Replacement upload failed");
  const { data: oldPath, error } = await db.rpc(
    "replace_organization_sponsor",
    {
      p_user_id: user.id,
      p_id: id,
      p_path: path,
      p_mime: image.mime,
      p_size: image.bytes.length,
    },
  );
  if (error) {
    await db.storage.from(BUCKET).remove([path]);
    throw new Error("Replacement upload failed");
  }
  if (typeof oldPath === "string")
    await db.storage.from(BUCKET).remove([oldPath]);
  return listSponsorLibrary(user);
}
