import { z } from "zod";

export const studioReplayStateSchema = z
  .object({
    state: z.number().int().min(0).max(7),
    durationMs: z.number().int().min(0).max(90000),
    availableMs: z.number().int().min(0).max(60000),
    clipId: z.uuid().nullable(),
  })
  .strict();

export const studioCoachReviewStateSchema = z
  .object({
    addresses: z.array(z.ipv4()).max(32),
    address: z.url().nullable(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .nullable(),
  })
  .strict();

export const studioSessionSchema = z
  .object({
    gameId: z.uuid().nullable(),
    title: z.string().max(200),
    active: z.boolean(),
    busy: z.boolean(),
    presentation: z.enum(["live", "hold", "preparing-end", "ended"]),
    streaming: z.string().max(40),
    outputActive: z.boolean(),
    live: z.boolean(),
    lastLiveAgeMs: z.number().nonnegative().nullable().optional(),
    canHoldStream: z.boolean(),
    canLeaveGame: z.boolean().optional(),
    canCloseGameDirectly: z.boolean().optional(),
    canCloseWorkspace: z.boolean().optional(),
    replay: studioReplayStateSchema.nullable().optional(),
    coachReview: studioCoachReviewStateSchema.nullable().optional(),
  })
  .strict();
export type StudioSession = z.infer<typeof studioSessionSchema>;

export function canCloseStudioGameDirectly(
  session: StudioSession | null,
  gameId: string,
) {
  return (
    session?.canCloseGameDirectly === true &&
    session.canLeaveGame === true &&
    !session.busy &&
    (session.gameId === gameId ||
      (!session.active && session.gameId === null)) &&
    session.streaming === "idle" &&
    session.presentation === "live" &&
    !session.outputActive &&
    !session.live
  );
}

export function studioLastLiveLabel(ageMs: number) {
  const seconds = Math.floor(ageMs / 1000);
  const age =
    seconds < 1
      ? "just now"
      : seconds < 60
        ? `${seconds}s ago`
        : seconds < 3600
          ? `${Math.floor(seconds / 60)}m ago`
          : `${Math.floor(seconds / 3600)}h ago`;
  return `Last confirmed live ${age}`;
}

export function sessionGamePath(path: string, gameId: string) {
  return ["score", "games", "broadcast", "studio-m2", "studio-m4"].some(
    (section) =>
      path === `/${section}/${gameId}` ||
      path.startsWith(`/${section}/${gameId}/`),
  );
}

export function studioSessionLabel(session: StudioSession) {
  if (!session.active) return "Studio disconnected";
  if (session.presentation === "hold" && session.outputActive)
    return "Broadcast paused";
  if (["preparing-end", "ended"].includes(session.presentation))
    return "Broadcast ending";
  if (session.live && session.outputActive) return "Broadcast live";
  if (["starting", "stopping"].includes(session.streaming))
    return "Broadcast connecting";
  if (session.outputActive && session.streaming === "armed")
    return session.lastLiveAgeMs != null
      ? `Sending video · ${studioLastLiveLabel(session.lastLiveAgeMs)}`
      : "Sending video · Awaiting YouTube";
  if (["failed", "paused"].includes(session.streaming))
    return "Broadcast disconnected";
  return "Broadcast not started";
}

export function shouldGuardStudioNavigation(
  session: StudioSession | null,
  current: string,
  destination: URL,
) {
  return Boolean(
    session?.active &&
    session.gameId &&
    (session.outputActive ||
      session.live ||
      session.streaming === "starting") &&
    sessionGamePath(current, session.gameId) &&
    !sessionGamePath(destination.pathname, session.gameId),
  );
}

export const studioNavigationRequestSchema = z
  .object({ gameId: z.uuid(), nonce: z.uuid(), href: z.string().max(4096) })
  .strict();
const navigationReceiptSchema = z
  .object({
    gameId: z.uuid(),
    nonce: z.uuid(),
    ok: z.boolean(),
    error: z.string().max(300).nullable().optional(),
  })
  .strict();

export function studioSessionBridge() {
  return (
    window as Window & {
      chrome?: { webview?: { postMessage(value: unknown): void } };
    }
  ).chrome?.webview;
}

export function resolveStudioNavigation(
  request: z.infer<typeof studioNavigationRequestSchema>,
  decision: "continue" | "pause" | "stay",
) {
  const bridge = studioSessionBridge();
  if (!bridge) return Promise.reject(Error("Windows Studio is unavailable."));
  return new Promise<void>((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      window.removeEventListener("studio-navigation-result", receive);
    };
    const receive = (event: Event) => {
      const parsed = navigationReceiptSchema.safeParse(
        (event as CustomEvent).detail,
      );
      if (
        !parsed.success ||
        parsed.data.gameId !== request.gameId ||
        parsed.data.nonce !== request.nonce
      )
        return;
      clean();
      if (parsed.data.ok) resolve();
      else
        reject(
          Error(
            parsed.data.error || "Studio could not confirm leaving this game.",
          ),
        );
    };
    const timer = window.setTimeout(() => {
      clean();
      reject(
        Error(
          "Studio did not confirm this action. Stay in the game and try again.",
        ),
      );
    }, 20000);
    window.addEventListener("studio-navigation-result", receive);
    try {
      bridge.postMessage({
        type: "studio-navigation-resolve",
        gameId: request.gameId,
        nonce: request.nonce,
        decision,
      });
    } catch {
      clean();
      reject(Error("Windows Studio is unavailable."));
    }
  });
}

/** Release an idle preview before explicitly preparing another game. Native
 * refuses this command whenever a YouTube sender is still active. */
export function stopStudioSession(gameId: string) {
  const bridge = studioSessionBridge();
  if (!bridge) return Promise.reject(Error("Windows Studio is unavailable."));
  const nonce = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      window.removeEventListener("studio-session-stop-result", receive);
    };
    const receive = (event: Event) => {
      const parsed = navigationReceiptSchema.safeParse(
        (event as CustomEvent).detail,
      );
      if (
        !parsed.success ||
        parsed.data.gameId !== gameId ||
        parsed.data.nonce !== nonce
      )
        return;
      clean();
      if (parsed.data.ok) resolve();
      else
        reject(
          Error(
            parsed.data.error ||
              "Studio could not release the current preview.",
          ),
        );
    };
    const timer = window.setTimeout(() => {
      clean();
      reject(
        Error(
          "Studio did not confirm switching games. Return to the active game and try again.",
        ),
      );
    }, 20000);
    window.addEventListener("studio-session-stop-result", receive);
    try {
      bridge.postMessage({ type: "studio-session-stop", gameId, nonce });
    } catch {
      clean();
      reject(Error("Windows Studio is unavailable."));
    }
  });
}

/** A correlated native acknowledgement is required before leaving the game. */
export function leaveStudioGame(
  gameId: string,
  { previewOnly = false }: { previewOnly?: boolean } = {},
) {
  const bridge = studioSessionBridge();
  if (!bridge)
    return Promise.reject(
      Error(
        previewOnly
          ? "Windows Studio is unavailable."
          : "Open this game in Windows Studio to pause its stream.",
      ),
    );
  const nonce = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      window.removeEventListener("studio-game-leave-result", receive);
    };
    const receive = (event: Event) => {
      const parsed = navigationReceiptSchema.safeParse(
        (event as CustomEvent).detail,
      );
      if (
        !parsed.success ||
        parsed.data.gameId !== gameId ||
        parsed.data.nonce !== nonce
      )
        return;
      clean();
      if (parsed.data.ok) resolve();
      else
        reject(
          Error(
            parsed.data.error ||
              (previewOnly
                ? "Studio could not close the preview. Try again."
                : "Studio could not confirm the pause. Stay here and retry."),
          ),
        );
    };
    const timer = window.setTimeout(
      () => {
        clean();
        reject(
          Error(
            previewOnly
              ? "The camera preview is taking longer to close. Check Studio and try again."
              : "Studio has not confirmed shutdown. Keep it open and check its status.",
          ),
        );
      },
      previewOnly ? 15000 : 130000,
    );
    window.addEventListener("studio-game-leave-result", receive);
    try {
      bridge.postMessage({
        type: "studio-game-leave",
        gameId,
        nonce,
        ...(previewOnly ? { previewOnly: true } : {}),
      });
    } catch {
      clean();
      reject(Error("Windows Studio is unavailable."));
    }
  });
}
