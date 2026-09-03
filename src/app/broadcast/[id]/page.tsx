"use client";
import { use } from "react";
import { useGame } from "@/components/GameSync";
import { BroadcastCanvas } from "@/components/BroadcastCanvas";
import { GameSetupNavigation } from "@/components/GameSetupNavigation";
export default function Broadcast({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { game } = useGame(id);
  if (!game) return <main className="p-8">Loading 1920×1080 program…</main>;
  return (
    <main className="min-h-screen bg-black p-2">
      <div className="mx-auto mb-2 max-w-7xl">
        <GameSetupNavigation id={id} />
      </div>
      <BroadcastCanvas game={game} />
      <p className="p-2 text-center text-sm text-slate-400">
        Live composition · designed at 1920×1080 · camera sources remain mounted
        and connected under sponsor breaks.
      </p>
    </main>
  );
}
