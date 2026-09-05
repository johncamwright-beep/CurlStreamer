import "server-only";
import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readAccessToken } from "@/lib/tokens";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";

const idSchema = z.string().uuid();

const verifiedAccountBrand = Symbol("verified-completion-account");

export type VerifiedCompletionAccount = {
  kind: "account";
  userId: string;
  [verifiedAccountBrand]: true;
};

export type CompletionCredential =
  VerifiedCompletionAccount | { kind: "organizer"; token: string };

export type CompletionResult = {
  outcome: "no_result" | "tie" | "home_win" | "away_win";
  label: string;
  totals: { home: number; away: number } | null;
  ends: unknown[];
};

export type CompletionReview = {
  reviewId: string;
  inputRevision: number;
  result: CompletionResult;
  youtubeWatchUrl: string | null;
};

export type GameCompletion = CompletionReview & {
  completionId: string;
  completedAt: string;
  cleanupStatus: "pending" | "failed" | "complete";
};

export type SafeGameCompletion = {
  status: "completed";
  eventName: string;
  homeName: string;
  awayName: string;
  result: CompletionResult;
  youtubeWatchUrl: string | null;
  completedAt: string;
};

export type CompletionCleanup = {
  status: "pending" | "failed" | "complete";
  attempts: number;
  lastError: string | null;
};

type FailureKind = "authorization" | "conflict" | "terminal" | "service";
type Result<T> = { ok: true; value: T } | { ok: false; kind: FailureKind };

/**
 * Establishes account authority from Supabase's server-validated session, not
 * from caller-supplied identity fields. SQL independently rechecks verified
 * email, active profile, organization, and owner/team-admin membership.
 */
export async function verifiedCompletionAccount(): Promise<
  Result<VerifiedCompletionAccount>
> {
  try {
    const { data, error } = await (
      await createServerSupabaseClient()
    ).auth.getUser();
    const user: User | null = data.user;
    if (error || !user || !user.email_confirmed_at)
      return { ok: false, kind: "authorization" };
    return {
      ok: true,
      value: {
        kind: "account",
        userId: idSchema.parse(user.id),
        [verifiedAccountBrand]: true,
      },
    };
  } catch {
    return { ok: false, kind: "authorization" };
  }
}

export async function completionActorParameters(
  gameId: string,
  credential: CompletionCredential,
) {
  if (credential.kind === "account")
    return {
      p_actor_user_id: idSchema.parse(credential.userId),
      p_verified_organizer: false,
    };

  const access = await readAccessToken(credential.token);
  if (access.gameId !== gameId || access.purpose !== "organizer")
    throw Object.assign(new Error("Organizer access required"), {
      code: "42501",
    });
  return { p_actor_user_id: null, p_verified_organizer: true };
}

function failure(error: { code?: string }): Result<never> {
  if (error.code === "42501") return { ok: false, kind: "authorization" };
  if (error.code === "40001") return { ok: false, kind: "conflict" };
  if (error.code === "55000") return { ok: false, kind: "terminal" };
  return { ok: false, kind: "service" };
}

function reviewRow(value: Record<string, unknown>): CompletionReview {
  return {
    reviewId: value.review_id as string,
    inputRevision: Number(value.input_revision),
    result: value.result as CompletionResult,
    youtubeWatchUrl: (value.youtube_watch_url as string | null) ?? null,
  };
}

/** Internal foundation only. Deliberately not exported from the store or a route. */
export async function reviewGameCompletion(
  gameId: string,
  credential: CompletionCredential,
  youtubeWatchUrl: string | null = null,
): Promise<Result<CompletionReview>> {
  try {
    const id = idSchema.parse(gameId);
    const actor = await completionActorParameters(id, credential);
    const watchUrl = youtubeWatchUrlSchema.parse(youtubeWatchUrl ?? "");
    const { data, error } = await createAdminSupabaseClient().rpc(
      "review_game_completion_with_link",
      {
        p_game_id: id,
        p_review_id: randomUUID(),
        p_youtube_watch_url: watchUrl,
        ...actor,
      },
    );
    if (error) return failure(error);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    return row
      ? { ok: true, value: reviewRow(row) }
      : { ok: false, kind: "service" };
  } catch (error) {
    return failure(error as { code?: string });
  }
}

/**
 * Completes only a previously reviewed database revision. The database repeats
 * authorization after taking the state/game locks and returns the original row
 * on a legitimate retry, including retries made after the game became terminal.
 */
export async function completeReviewedGame(
  gameId: string,
  reviewId: string,
  credential: CompletionCredential,
): Promise<Result<GameCompletion>> {
  try {
    const id = idSchema.parse(gameId);
    const actor = await completionActorParameters(id, credential);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "complete_reviewed_game",
      {
        p_game_id: id,
        p_review_id: idSchema.parse(reviewId),
        p_completion_id: randomUUID(),
        ...actor,
      },
    );
    if (error) return failure(error);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    if (!row) return { ok: false, kind: "service" };
    return {
      ok: true,
      value: {
        ...reviewRow(row),
        completionId: row.completion_id as string,
        completedAt: row.completed_at as string,
        cleanupStatus: row.cleanup_status as GameCompletion["cleanupStatus"],
      },
    };
  } catch (error) {
    return failure(error as { code?: string });
  }
}

export async function readGameCompletionSummary(
  gameId: string,
): Promise<SafeGameCompletion | undefined> {
  const id = idSchema.parse(gameId);
  const { data, error } = await createAdminSupabaseClient().rpc(
    "read_game_completion_summary",
    { p_game_id: id },
  );
  if (error) throw error;
  if (!data) return;
  const value = data as Record<string, unknown>;
  return {
    status: "completed",
    eventName: String(value.eventName ?? "Completed game"),
    homeName: String(value.homeName ?? "Home"),
    awayName: String(value.awayName ?? "Away"),
    result: value.result as CompletionResult,
    youtubeWatchUrl: (value.youtubeWatchUrl as string | null) ?? null,
    completedAt: String(value.completedAt),
  };
}

function cleanupRow(value: Record<string, unknown>): CompletionCleanup {
  return {
    status: value.status as CompletionCleanup["status"],
    attempts: Number(value.attempts),
    lastError: (value.last_error as string | null) ?? null,
  };
}

export async function getCompletionCleanup(
  gameId: string,
  credential: CompletionCredential,
): Promise<Result<CompletionCleanup>> {
  try {
    const id = idSchema.parse(gameId);
    const actor = await completionActorParameters(id, credential);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "get_game_completion_cleanup",
      { p_game_id: id, ...actor },
    );
    if (error) return failure(error);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    return row
      ? { ok: true, value: cleanupRow(row) }
      : { ok: false, kind: "service" };
  } catch (error) {
    return failure(error as { code?: string });
  }
}

export async function recordCompletionCleanup(
  gameId: string,
  credential: CompletionCredential,
  outcome: { succeeded: boolean; error?: string },
): Promise<Result<CompletionCleanup>> {
  try {
    const id = idSchema.parse(gameId);
    const actor = await completionActorParameters(id, credential);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "record_game_completion_cleanup",
      {
        p_game_id: id,
        p_succeeded: outcome.succeeded,
        p_error: outcome.error ?? null,
        ...actor,
      },
    );
    if (error) return failure(error);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    return row
      ? { ok: true, value: cleanupRow(row) }
      : { ok: false, kind: "service" };
  } catch (error) {
    return failure(error as { code?: string });
  }
}
