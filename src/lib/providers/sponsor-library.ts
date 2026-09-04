import "server-only";
import { randomUUID } from "crypto";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getAccountContext } from "@/lib/auth/account";
import { loadActiveTeam } from "@/lib/team-games";
import type { Sponsor } from "@/lib/types";

export const SPONSOR_BUCKET = "organization-sponsors";
export const SPONSOR_URL_SECONDS = 12 * 60 * 60;
export const MAX_SPONSOR_BYTES = 12 * 1024 * 1024;

const metadataSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  altText: z.string().trim().min(1).max(240),
});
const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rename"),
    sponsorId: z.uuid(),
    ...metadataSchema.shape,
  }),
  z.object({ action: z.enum(["archive", "restore"]), sponsorId: z.uuid() }),
  z.object({
    action: z.literal("reorder"),
    sponsorId: z.uuid(),
    orderedIds: z.array(z.uuid()).min(1),
  }),
]);

export type SponsorRecord = {
  id: string;
  organization_id: string;
  display_name: string;
  alt_text: string;
  storage_path: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  sort_order: number;
  archived_at: string | null;
  updated_at: string;
};

function safeFailure(error: unknown): never {
  const code = (error as { code?: unknown } | null)?.code;
  console.error("Sponsor library operation failed", {
    code: typeof code === "string" ? code : "unknown",
  });
  throw new Error("Sponsor library operation could not be completed.");
}

export function inspectSponsorImage(bytes: Uint8Array, claimedType: string) {
  if (!bytes.length || bytes.length > MAX_SPONSOR_BYTES)
    throw new Error("Sponsor images must be no larger than 12 MB.");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const ascii = String.fromCharCode(...bytes.slice(0, 12));
  const webp = ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  const actual = jpeg
    ? "image/jpeg"
    : png
      ? "image/png"
      : webp
        ? "image/webp"
        : null;
  if (!actual || actual !== claimedType)
    throw new Error("Use a valid JPEG, PNG, or WebP image.");
  return actual;
}

async function manager(user: User) {
  const team = await loadActiveTeam(user);
  if (
    team.kind === "ready" &&
    (team.team.role === "owner" || team.team.role === "team_admin")
  )
    return team.team;
  throw new Error(
    "Sponsor library management is not available for this account.",
  );
}

export async function listSponsorRecords(
  organizationId: string,
  includeArchived = false,
) {
  let query = createAdminSupabaseClient()
    .from("organization_sponsors")
    .select(
      "id,organization_id,display_name,alt_text,storage_path,mime_type,bytes,sort_order,archived_at,updated_at",
    )
    .eq("organization_id", organizationId)
    .order("sort_order")
    .order("created_at")
    .order("id");
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) safeFailure(error);
  return (data ?? []) as SponsorRecord[];
}

export async function signedSponsors(
  organizationId: string,
): Promise<Sponsor[]> {
  const db = createAdminSupabaseClient();
  const records = await listSponsorRecords(organizationId);
  if (!records.length) return [];
  const { data, error } = await db.storage
    .from(SPONSOR_BUCKET)
    .createSignedUrls(
      records.map((record) => record.storage_path),
      SPONSOR_URL_SECONDS,
    );
  if (error) safeFailure(error);
  return records.flatMap((record, index) => {
    const url = data?.[index]?.signedUrl;
    return url
      ? [
          {
            id: record.id,
            name: record.alt_text,
            displayName: record.display_name,
            dataUrl: url,
            enabled: true,
            rotation: 0,
          },
        ]
      : [];
  });
}

export async function libraryForAccount(user: User) {
  const [context, team] = await Promise.all([
    getAccountContext(user),
    loadActiveTeam(user),
  ]);
  if (
    !context.ok ||
    team.kind !== "ready" ||
    !context.account.membership ||
    context.account.membership.organization_id !== team.team.organizationId
  )
    throw new Error("Sponsor library is unavailable.");
  const membership = context.account.membership;
  const records = await listSponsorRecords(team.team.organizationId, true);
  const urls = await Promise.all(
    records.map(async (record) => {
      const { data } = await createAdminSupabaseClient()
        .storage.from(SPONSOR_BUCKET)
        .createSignedUrl(record.storage_path, SPONSOR_URL_SECONDS);
      return { ...record, imageUrl: data?.signedUrl ?? null };
    }),
  );
  return {
    sponsors: urls,
    role: team.team.role,
    teamName: membership.teamName,
  };
}

async function rpc(user: User, values: Record<string, unknown>) {
  const { error } = await createAdminSupabaseClient().rpc(
    "manage_organization_sponsor",
    {
      p_user_id: user.id,
      p_display_name: null,
      p_alt_text: null,
      p_mime_type: null,
      p_bytes: null,
      p_ordered_ids: null,
      ...values,
    },
  );
  if (error) safeFailure(error);
}

export async function uploadSponsor(
  user: User,
  file: File,
  input: unknown,
  sponsorId?: string,
) {
  const membership = await manager(user);
  const metadata = metadataSchema.parse(input);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = inspectSponsorImage(bytes, file.type);
  const id = sponsorId ?? randomUUID();
  const path = `organizations/${membership.organizationId}/sponsors/${id}`;
  const replacing = Boolean(sponsorId);
  if (replacing) {
    const existing = (
      await listSponsorRecords(membership.organizationId, true)
    ).find((x) => x.id === id);
    if (!existing || existing.storage_path !== path)
      throw new Error("Sponsor was not found.");
  }
  const db = createAdminSupabaseClient();
  const { error } = await db.storage
    .from(SPONSOR_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: replacing });
  if (error) safeFailure(error);
  try {
    await rpc(user, {
      p_action: replacing ? "replace" : "create",
      p_sponsor_id: id,
      p_display_name: metadata.displayName,
      p_alt_text: metadata.altText,
      p_mime_type: mime,
      p_bytes: bytes.length,
    });
  } catch (error) {
    if (!replacing) await db.storage.from(SPONSOR_BUCKET).remove([path]);
    throw error;
  }
}

export async function mutateSponsor(user: User, input: unknown) {
  await manager(user);
  const value = mutationSchema.parse(input);
  await rpc(user, {
    p_action: value.action,
    p_sponsor_id: value.sponsorId,
    ...(value.action === "rename"
      ? { p_display_name: value.displayName, p_alt_text: value.altText }
      : {}),
    ...(value.action === "reorder" ? { p_ordered_ids: value.orderedIds } : {}),
  });
}
