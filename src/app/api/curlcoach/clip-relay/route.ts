import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "@/lib/curlcoach/access";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import {
  completionActorParameters,
  verifiedCompletionAccount,
} from "@/lib/game-completion";
import { issueCoachClipRelayToken } from "@/lib/providers/livekit";
import { studioOrigin } from "@/lib/studio-origin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    gameId: z.uuid().transform((id) => id.toLowerCase()),
    role: z.enum(["coach", "studio"]),
  })
  .strict();

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      vary: "Cookie, Authorization",
    },
  });
}

function denied() {
  return reply({ error: "Clip relay access is required for this game." }, 403);
}

async function parseBody(request: Request) {
  try {
    const raw = await request.text();
    return bodySchema.safeParse(raw.length <= 1024 ? JSON.parse(raw) : null);
  } catch {
    return bodySchema.safeParse(null);
  }
}

async function studioActor(request: Request, gameId: string) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (token) {
    try {
      return await completionActorParameters(gameId, {
        kind: "organizer",
        token,
      });
    } catch {
      /* A stale organizer token cannot replace a verified account session. */
    }
  }
  const account = await verifiedCompletionAccount();
  return account.ok
    ? completionActorParameters(gameId, account.value)
    : undefined;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return denied();

  try {
    if (
      origin !== studioOrigin(request) &&
      !(process.env.NODE_ENV !== "production" && sameOrigin(request))
    )
      return denied();
    if (process.env.CURLCOACH_ENABLED !== "true")
      return reply({ error: "Clip relay is unavailable." }, 503);

    const body = await parseBody(request);
    if (!body.success)
      return reply({ error: "Invalid clip relay request." }, 400);
    const { gameId, role } = body.data;

    let actor;
    if (role === "coach") {
      const coach = await requireCoachAccount();
      if (!coach) return denied();
      actor = {
        p_actor_user_id: coach.userId,
        p_verified_organizer: false,
        p_organization_id: coach.organizationId,
      };
    } else {
      const studio = await studioActor(request, gameId);
      if (!studio) return denied();
      actor = { ...studio, p_organization_id: null };
    }

    const admin = createAdminSupabaseClient();
    const assertAuthority = async () => {
      const { error } = await admin.rpc("authorize_coach_clip_relay", {
        p_game_id: gameId,
        p_role: role,
        ...actor,
      });
      if (error?.code === "42501" || error?.code === "P0402") return false;
      if (error) throw Error("Clip relay authorization failed");
      return true;
    };
    if (!(await assertAuthority())) return denied();
    const credential = await issueCoachClipRelayToken(gameId, role);
    // Closing the game or revoking access during signing fences the reply.
    if (!(await assertAuthority())) return denied();
    return reply(credential);
  } catch {
    return reply({ error: "Clip relay is unavailable." }, 503);
  }
}
