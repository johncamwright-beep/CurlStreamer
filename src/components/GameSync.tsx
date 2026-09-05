"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/types";
import type { BroadcastGame, JoinGame } from "@/lib/game-projection";
import { clearCurrentGameIfMatching } from "@/lib/current-game";
import type { SafeGameCompletion } from "@/lib/game-completion";
import { GameRefreshGate } from "@/lib/game-refresh-gate";
import { fetchGameWithSelectedAccess } from "@/lib/media-access-client";
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
) {
  const [game, setGame] = useState<ViewState<V>>();
  const [completion, setCompletion] = useState<SafeGameCompletion>();
  const [lifecycle, setLifecycle] = useState<GameLifecycle>();
  const [error, setError] = useState("");
  const [accountOperator, setAccountOperator] = useState(false);
  const [accountRole, setAccountRole] = useState("");
  const refreshGate = useRef(new GameRefreshGate());
  const refresh = useCallback(async () => {
    const ticket = refreshGate.current.start();
    let r: Response;
    try {
      r = await fetchGameWithSelectedAccess(id, view, invitation, localStorage);
    } catch {
      if (!refreshGate.current.accept(ticket)) return;
      setError("Game service is temporarily unavailable.");
      return;
    }
    if (r.ok) {
      const body = await r.json();
      const nextLifecycle =
        body?.status === "completed" ? "completed" : "active";
      if (!refreshGate.current.accept(ticket, nextLifecycle)) return;
      if (nextLifecycle === "completed") {
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
      setError("");
    } else {
      const body = await r.json().catch(() => null);
      const nextLifecycle =
        r.status === 410 && ["closed", "deleted"].includes(body?.lifecycle)
          ? (body.lifecycle as "closed" | "deleted")
          : undefined;
      if (!refreshGate.current.accept(ticket, nextLifecycle)) return;
      setGame(undefined);
      setCompletion(undefined);
      setAccountOperator(false);
      setAccountRole("");
      if (nextLifecycle) setLifecycle(nextLifecycle);
      if ([401, 404, 410].includes(r.status))
        clearCurrentGameIfMatching(localStorage, id);
      setError(body?.error ?? "Game is unavailable.");
    }
  }, [id, view, invitation]);
  useEffect(() => {
    refreshGate.current.reset();
    setGame(undefined);
    setCompletion(undefined);
    setLifecycle(undefined);
    setError("");
    setAccountOperator(false);
    setAccountRole("");
    void refresh();
    const timer = setInterval(refresh, 1000);
    const channel = new BroadcastChannel(`curlcast-${id}`);
    channel.onmessage = () => void refresh();
    return () => {
      clearInterval(timer);
      channel.close();
    };
  }, [id, refresh]);
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
  };
}
