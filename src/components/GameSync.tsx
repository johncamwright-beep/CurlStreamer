"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/types";
import type { BroadcastGame, JoinGame } from "@/lib/game-projection";
import { clearCurrentGameIfMatching } from "@/lib/current-game";
import type { SafeGameCompletion } from "@/lib/game-completion";
import { gamePollDelay } from "@/lib/game-polling";
import { GameRefreshGate } from "@/lib/game-refresh-gate";
import { fetchGameWithSelectedAccess } from "@/lib/media-access-client";
import type { GameNavigationMetadata } from "@/lib/game-entry";
type GameView = "broadcast" | "join" | undefined;
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
  const refresh = useCallback(
    async (includeNavigationMetadata = false) => {
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
        if (!refreshGate.current.accept(ticket)) return;
        setError("Game service is temporarily unavailable.");
        return;
      }
      if (r.ok) {
        const body = await r.json().catch(() => null);
        if (
          !body ||
          typeof body !== "object" ||
          (!body.config && body.status !== "completed")
        ) {
          if (refreshGate.current.accept(ticket))
            setError("Game details could not be read. Try again.");
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
        setError("");
      } else {
        const body = await r.json().catch(() => null);
        const nextLifecycle =
          r.status === 410 && ["closed", "deleted"].includes(body?.lifecycle)
            ? (body.lifecycle as "closed" | "deleted")
            : undefined;
        if (!refreshGate.current.accept(ticket, nextLifecycle)) return;
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
        setError(body?.error ?? "Game is unavailable.");
      }
    },
    [id, view, invitation, includeContext],
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
      const token = localStorage.getItem(`curlcast-access-${id}`);
      const r = await fetch(`/api/games/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(action),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        await refresh();
        throw new Error(body?.error ?? "That update could not be saved.");
      }
      const next = await r.json();
      setGame(next);
      const channel = new BroadcastChannel(`curlcast-${id}`);
      channel.postMessage("update");
      channel.close();
    },
    [id, refresh],
  );
  return {
    game,
    completion,
    lifecycle,
    error,
    act,
    refresh,
    accountOperator,
    accountRole,
    m1Pilot,
    navigationMetadata,
    refreshContext: () => refresh(true),
  };
}
