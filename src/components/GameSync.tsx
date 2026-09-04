"use client";
import { useCallback, useEffect, useState } from "react";
import type { GameState } from "@/lib/types";
import type { BroadcastGame, JoinGame } from "@/lib/game-projection";
import { clearCurrentGame, readCurrentGame } from "@/lib/current-game";
type GameView = "broadcast" | "join" | undefined;
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
  const [error, setError] = useState("");
  const [accountOperator, setAccountOperator] = useState(false);
  const [accountRole, setAccountRole] = useState("");
  const refresh = useCallback(async () => {
    const token = invitation ?? localStorage.getItem(`curlcast-access-${id}`);
    const r = await fetch(`/api/games/${id}${view ? `?view=${view}` : ""}`, {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (r.ok) {
      setGame(await r.json());
      setAccountOperator(r.headers.get("x-curlcast-operator") === "true");
      setAccountRole(r.headers.get("x-curlcast-account-role") ?? "");
      setError("");
    } else {
      setGame(undefined);
      setAccountOperator(false);
      setAccountRole("");
      if (
        [401, 404, 410].includes(r.status) &&
        readCurrentGame(localStorage)?.id === id
      )
        clearCurrentGame(localStorage);
      const body = await r.json().catch(() => null);
      setError(body?.error ?? "Game is unavailable.");
    }
  }, [id, view, invitation]);
  useEffect(() => {
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
  return { game, error, act, refresh, accountOperator, accountRole };
}
