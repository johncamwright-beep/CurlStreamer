"use client";
import { use, useEffect, useState } from "react";
import { useGame } from "@/components/GameSync";
import { BroadcastCanvas } from "@/components/BroadcastCanvas";
export default function Broadcast({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { game } = useGame(id);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);
  if (!game) return <main className="p-8">Loading 1920×1080 program…</main>;
  return (
    <main className="broadcast-viewport">
      <div
        className="broadcast-fixed-canvas"
        style={{ transform: `scale(${scale})` }}
      >
        <BroadcastCanvas game={game} />
      </div>
    </main>
  );
}
