import "server-only";

import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const statusRow = z.object({
  channel_id: z.string().nullable(),
  channel_title: z.string().nullable(),
  connection_status: z.enum([
    "connected",
    "reconnect_required",
    "disconnected",
  ]),
  connection_version: z.coerce.number().int().nonnegative(),
  connected_at: z.string().nullable(),
  tested_at: z.string().nullable(),
  last_error_code: z.string().nullable(),
  can_manage: z.boolean(),
});
const attemptRow = z.object({
  organization_id: z.uuid(),
  expected_version: z.coerce.number().int().nonnegative(),
});
const credentialRow = z.object({
  organization_id: z.uuid(),
  encrypted_credentials: z.string().min(1),
  channel_id: z.string().min(1),
  connection_version: z.coerce.number().int().nonnegative(),
});

export type YouTubeConnection = z.infer<typeof statusRow>;

function diagnostic(operation: string, error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  console.error("YouTube connection service unavailable", {
    operation,
    code: typeof code === "string" ? code : "unknown",
  });
}

async function rpc<T>(
  operation: string,
  name: string,
  parameters: Record<string, unknown>,
  schema: z.ZodType<T>,
) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    name,
    parameters,
  );
  if (error) {
    diagnostic(operation, error);
    throw new Error(`youtube_${operation}_failed`);
  }
  return schema.parse(data);
}

export async function getYouTubeConnection(
  user: User,
): Promise<YouTubeConnection | null> {
  const rows = await rpc(
    "read",
    "get_youtube_connection",
    { p_user_id: user.id },
    z.array(statusRow),
  );
  return rows[0] ?? null;
}

export async function beginYouTubeOAuth(
  user: User,
  stateHash: string,
  expiresAt: string,
) {
  const rows = await rpc(
    "oauth_begin",
    "begin_youtube_oauth",
    { p_user_id: user.id, p_state_hash: stateHash, p_expires_at: expiresAt },
    z.array(attemptRow),
  );
  if (rows.length !== 1) throw new Error("youtube_oauth_begin_failed");
  return rows[0];
}

export async function consumeYouTubeOAuth(user: User, stateHash: string) {
  const rows = await rpc(
    "oauth_consume",
    "consume_youtube_oauth",
    { p_user_id: user.id, p_state_hash: stateHash },
    z.array(attemptRow),
  );
  if (rows.length !== 1) throw new Error("youtube_oauth_expired");
  return rows[0];
}

export async function getYouTubeCredentials(user: User) {
  const rows = await rpc(
    "credentials",
    "get_youtube_credentials",
    { p_user_id: user.id },
    z.array(credentialRow),
  );
  if (rows.length !== 1) throw new Error("youtube_reconnect_required");
  return rows[0];
}

export async function completeYouTubeConnection(
  user: User,
  values: {
    organizationId: string;
    expectedVersion: number;
    encryptedCredentials: string;
    channelId: string;
    channelTitle: string;
  },
) {
  await rpc(
    "oauth_complete",
    "complete_youtube_connection",
    {
      p_user_id: user.id,
      p_expected_organization_id: values.organizationId,
      p_expected_version: values.expectedVersion,
      p_encrypted_credentials: values.encryptedCredentials,
      p_channel_id: values.channelId,
      p_channel_title: values.channelTitle,
    },
    z.coerce.number().int().positive(),
  );
}

export async function finishYouTubeConnectionTest(
  user: User,
  organizationId: string,
  expectedVersion: number,
  ok: boolean,
  errorCode: string | null,
) {
  await rpc(
    "test_finish",
    "finish_youtube_connection_test",
    {
      p_user_id: user.id,
      p_expected_organization_id: organizationId,
      p_expected_version: expectedVersion,
      p_ok: ok,
      p_error_code: errorCode,
    },
    z.null(),
  );
}

export async function disconnectYouTubeConnection(user: User) {
  await rpc(
    "disconnect",
    "disconnect_youtube_connection",
    { p_user_id: user.id },
    z.coerce.number().int().positive(),
  );
}
