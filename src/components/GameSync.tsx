"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/types";
import type { BroadcastGame, JoinGame } from "@/lib/game-projection";
import { clearCurrentGameIfMatching } from "@/lib/current-game";
import type { SafeGameCompletion } from "@/lib/game-completion";
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
          fetch,
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
    const timer = setInterval(() => void refresh(), 1000);
    const channel = new BroadcastChannel(`curlcast-${id}`);
    channel.onmessage = () => void refresh();
    return () => {
      clearInterval(timer);
      currentContextGate.reset();
      channel.close();
    };
  }, [id, refresh, includeContext]);
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
      new BroadcastChannel(`curlcast-${id}`).postMessage("update");
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
