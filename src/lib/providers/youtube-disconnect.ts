import "server-only";

import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { decryptYouTubeRefreshToken } from "./youtube-credential-vault";
import { revokeYouTubeRefreshToken } from "./youtube-revocation";

const receiptSchema = z
  .array(
    z
      .object({
        organization_id: z.uuid(),
        encrypted_credentials: z.string().min(1).nullable(),
        connection_version: z.coerce.number().int().nonnegative(),
        disconnect_operation_id: z.uuid().nullable(),
      })
      .refine(
        (row) =>
          Boolean(row.encrypted_credentials) ===
          Boolean(row.disconnect_operation_id),
      ),
  )
  .length(1);

/** Keep the credential fenced and encrypted until Google confirms revocation. */
export async function revokeAndDisconnectYouTubeConnection(
  user: User,
  fetcher: typeof fetch = fetch,
) {
  const client = createAdminSupabaseClient();
  const begun = await client.rpc("begin_youtube_disconnect", {
    p_user_id: user.id,
  });
  if (begun.error) {
    if (
      begun.error.code === "55000" &&
      begun.error.message === "youtube connection has an unfinished broadcast"
    )
      throw new Error("youtube_connection_in_use");
    throw new Error("youtube_disconnect_failed");
  }
  const parsed = receiptSchema.safeParse(begun.data);
  if (!parsed.success) throw new Error("youtube_disconnect_failed");
  const receipt = parsed.data[0];
  if (!receipt.encrypted_credentials || !receipt.disconnect_operation_id)
    return;

  try {
    const refreshToken = decryptYouTubeRefreshToken(
      receipt.encrypted_credentials,
      receipt.organization_id,
    );
    await revokeYouTubeRefreshToken(refreshToken, fetcher);
    const finished = await client.rpc("finish_youtube_disconnect", {
      p_user_id: user.id,
      p_expected_organization_id: receipt.organization_id,
      p_expected_version: receipt.connection_version,
      p_disconnect_operation_id: receipt.disconnect_operation_id,
    });
    if (
      finished.error ||
      !z.coerce.number().int().positive().safeParse(finished.data).success
    )
      throw new Error("youtube_disconnect_pending");
  } catch {
    // The durable marker stays pending; retry resumes the same operation and
    // treats Google's already-revoked response as a successful revocation.
    throw new Error("youtube_disconnect_pending");
  }
}
