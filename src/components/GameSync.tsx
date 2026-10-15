"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "@/lib/types";
import type { BroadcastGame, JoinGame } from "@/lib/game-projection";
import { clearCurrentGameIfMatching } from "@/lib/current-game";
import type { SafeGameCompletion } from "@/lib/game-completion";
import { gamePollDelay } from "@/lib/game-polling";
import { GameRefreshGate } from "@/lib/game-refresh-gate";
import { GameWriteFence } from "@/lib/game-write-fence";
import { fetchGameWithSelectedAccess } from "@/lib/media-access-client";
import type { GameNavigationMetadata } from "@/lib/game-entry";
import { scoringIntentMatches } from "@/lib/scoring-acknowledgement";
type GameView = "broadcast" | "join" | undefined;
export class GameUpdateError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
export type GameLifecycle = "active" | "completed" | "closed" | "deleted";
type ViewState<V extends GameView> = V extends "broadcast"
  ? GameState | BroadcastGame
  : V extends "join"
    ? JoinGame
    : GameState;
export function useGame<V extends GameView = undefined>(
  id: string,
  view?: V,
  invitation?: string | null,
  includeContext = false,
  keepLiveWhenHidden = view === "broadcast",
) {
  const [game, setGame] = useState<ViewState<V>>();
  const [completion, setCompletion] = useState<SafeGameCompletion>();
  const [lifecycle, setLifecycle] = useState<GameLifecycle>();
  const [error, setError] = useState("");
  const [accountOperator, setAccountOperator] = useState(false);
  const [accountRole, setAccountRole] = useState("");
  const [m1Pilot, setM1Pilot] = useState(false);
  const [navigationMetadata, setNavigationMetadata] =
    useState<GameNavigationMetadata>();
  const pollingState = useRef({ lifecycle, error });
  pollingState.current = { lifecycle, error };
  const refreshGate = useRef(new GameRefreshGate());
  const contextGate = useRef(new GameRefreshGate());
  const writeScope = useMemo(
    () => ({
      fence: new GameWriteFence(),
      queue: Promise.resolve() as Promise<unknown>,
    }),
    [id, view, invitation],
  );
  const currentWriteScope = useRef(writeScope);
  currentWriteScope.current = writeScope;
  const refresh = useCallback(
    async (includeNavigationMetadata = false) => {
      if (currentWriteScope.current !== writeScope) return;
      const readEpoch = writeScope.fence.read();
      if (readEpoch === undefined) return;
      const reportError = (message: string) => {
        // The next poll is scheduled before React necessarily commits a render.
        // Recovery must not inherit the previous outage's ten-second delay.
        pollingState.current.error = message;
        setError(message);
      };
      const ticket = refreshGate.current.start();
      const contextTicket =
        includeNavigationMetadata && includeContext
          ? contextGate.current.start()
          : undefined;
      let r: Response;
      try {
        r = await fetchGameWithSelectedAccess(
          id,
          view,
          invitation,
          localStorage,
          (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
          includeNavigationMetadata && includeContext && view !== "join",
        );
      } catch {
        if (
          currentWriteScope.current !== writeScope ||
          !writeScope.fence.accepts(readEpoch)
        )
          return;
        if (!refreshGate.current.accept(ticket)) return;
        reportError("Game service is temporarily unavailable.");
        return;
      }
      if (r.ok) {
        const body = await r.json().catch(() => null);
        if (
          currentWriteScope.current !== writeScope ||
          !writeScope.fence.accepts(readEpoch)
        )
          return;
        if (
          !body ||
          typeof body !== "object" ||
          (!body.config && body.status !== "completed")
        ) {
          if (refreshGate.current.accept(ticket))
            reportError("Game details could not be read. Try again.");
          return;
        }
        const nextLifecycle =
          body?.status === "completed" ? "completed" : "active";
        const accepted = refreshGate.current.accept(ticket, nextLifecycle);
        // A newer state poll must not discard a requested schedule refresh.
        // Access loss, terminal state and route changes invalidate its own gate.
        if (
          contextTicket &&
          nextLifecycle === "active" &&
          contextGate.current.accept(contextTicket)
        )
          setNavigationMetadata(
            body.navigationMetadata ?? { state: "unavailable" },
          );
        if (!accepted) return;
        if (nextLifecycle === "completed") {
          contextGate.current.reset();
          setNavigationMetadata(undefined);
          clearCurrentGameIfMatching(localStorage, id);
          setGame(undefined);
          setCompletion(body as SafeGameCompletion);
          setLifecycle("completed");
        } else {
          setGame(body);
          setCompletion(undefined);
          setLifecycle("active");
        }
        setAccountOperator(r.headers.get("x-curlcast-operator") === "true");
        setAccountRole(r.headers.get("x-curlcast-account-role") ?? "");
        setM1Pilot(r.headers.get("x-curlcast-m1-pilot") === "true");
        pollingState.current.lifecycle = nextLifecycle;
        reportError("");
        return true;
      } else {
        const body = await r.json().catch(() => null);
        if (
          currentWriteScope.current !== writeScope ||
          !writeScope.fence.accepts(readEpoch)
        )
          return;
        const nextLifecycle =
          r.status === 410 && ["closed", "deleted"].includes(body?.lifecycle)
            ? (body.lifecycle as "closed" | "deleted")
            : undefined;
        if (!refreshGate.current.accept(ticket, nextLifecycle)) return;
        if ([408, 429, 500, 502, 503, 504].includes(r.status)) {
          reportError("Game service is temporarily unavailable. Reconnecting…");
          return;
        }
        contextGate.current.reset();
        setGame(undefined);
        setCompletion(undefined);
        setAccountOperator(false);
        setAccountRole("");
        setM1Pilot(false);
        setNavigationMetadata(undefined);
        if (nextLifecycle) setLifecycle(nextLifecycle);
        if ([401, 404, 410].includes(r.status))
          clearCurrentGameIfMatching(localStorage, id);
        if (nextLifecycle) pollingState.current.lifecycle = nextLifecycle;
        reportError(body?.error ?? "Game is unavailable.");
      }
    },
    [id, view, invitation, includeContext, writeScope],
  );
  useEffect(() => {
    refreshGate.current.reset();
    const currentContextGate = contextGate.current;
    currentContextGate.reset();
    setGame(undefined);
    setCompletion(undefined);
    setLifecycle(undefined);
    setError("");
    setAccountOperator(false);
    setAccountRole("");
    setM1Pilot(false);
    setNavigationMetadata(undefined);
    // Routine state reads must recover even if initial context enrichment stalls.
    // Their responses have separate ordering and never request schedule metadata.
    void refresh(includeContext);
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(
        poll,
        gamePollDelay({
          ...pollingState.current,
          hidden: document.hidden,
          keepLiveWhenHidden,
        }),
      );
    };
    const poll = async () => {
      if (stopped || (running && !keepLiveWhenHidden)) return;
      running = true;
      clearTimeout(timer);
      // Live receivers must still observe terminal state if an older read stalls.
      if (keepLiveWhenHidden) schedule();
      try {
        await refresh();
      } finally {
        running = false;
        if (!keepLiveWhenHidden) schedule();
      }
    };
    const onVisibility = () => {
      if (!document.hidden) void poll();
      else if (!running) {
        clearTimeout(timer);
        schedule();
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    const channel = new BroadcastChannel(`curlcast-${id}`);
    channel.onmessage = () => void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      currentContextGate.reset();
      channel.close();
    };
  }, [id, refresh, includeContext, keepLiveWhenHidden]);
  const act = useCallback(
    async (action: unknown) => {
      // Serialize program and scoring writes too: an older PATCH response must
      // never overwrite a newer scoring acknowledgement.
      const operation = writeScope.queue
        .catch(() => undefined)
        .then(async () => {
          if (currentWriteScope.current !== writeScope)
            throw new GameUpdateError(
              "The selected game changed. Reload its controls.",
              "game_unavailable",
            );
          writeScope.fence.begin();
          let failure: GameUpdateError | undefined;
          try {
            const token = localStorage.getItem(`curlcast-access-${id}`);
            const r = await fetch(`/api/games/${id}`, {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
                ...(token ? { authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify(action),
              signal: AbortSignal.timeout(15_000),
            });
            if (!r.ok) {
              const body = (await r.json().catch(() => null)) as {
                error?: string;
                code?: string;
              } | null;
              throw new GameUpdateError(
                body?.error ?? "That update could not be saved.",
                body?.code,
              );
            }
            const next = await r.json();
            if (currentWriteScope.current !== writeScope)
              throw new GameUpdateError(
                "The selected game changed. Reload its controls.",
                "game_unavailable",
              );
            if (
              !next?.config ||
              next.id !== id ||
              !Array.isArray(next.scoreEvents) ||
              !scoringIntentMatches(next.scoreEvents, action)
            )
              throw new GameUpdateError(
                "Save confirmation was not received. Retry the same change to confirm it safely.",
                "save_unconfirmed",
              );
            if (
              !refreshGate.current.accept(refreshGate.current.start(), "active")
            )
              throw new GameUpdateError(
                "This game is no longer available for scoring.",
                "game_unavailable",
              );
            setGame(next);
            const channel = new BroadcastChannel(`curlcast-${id}`);
            channel.postMessage("update");
            channel.close();
          } catch (error) {
            failure =
              error instanceof GameUpdateError
                ? error
                : new GameUpdateError(
                    "Save confirmation was not received. Retry the same change to confirm it safely.",
                    "save_unconfirmed",
                  );
          } finally {
            writeScope.fence.finish();
          }
          if (failure) {
            const recovered = await refresh();
            if (failure.code === "scoring_stale_intent" && !recovered)
              throw new GameUpdateError(
                "The game changed, but its current score could not be loaded. Retry to refresh it safely.",
                "save_unconfirmed",
              );
            throw failure;
          }
        });
      writeScope.queue = operation;
      await operation;
    },
    [id, refresh, writeScope],
  );
  const refreshGame = useCallback(async () => {
    await refresh();
  }, [refresh]);
  const refreshContext = useCallback(async () => {
    await refresh(true);
  }, [refresh]);
  return {
    game,
    completion,
    lifecycle,
    error,
    act,
    refresh: refreshGame,
    accountOperator,
    accountRole,
    m1Pilot,
    navigationMetadata,
    refreshContext,
  };
}
