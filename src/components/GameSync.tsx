"use client";
import { useCallback, useEffect, useState } from "react";
import type { GameState } from "@/lib/types";
export function useGame(id: string) {
  const [game, setGame] = useState<GameState>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const r = await fetch(`/api/games/${id}`, { cache: "no-store" });
    if (r.ok) setGame(await r.json());
    else setError("Game is unavailable.");
  }, [id]);
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
  return { game, error, act, refresh };
}
