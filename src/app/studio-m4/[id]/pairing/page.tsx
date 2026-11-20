import React from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { M4DesktopPairing } from "@/components/M4DesktopPairing";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (process.env.CURLCAST_M4_LOCAL_YOUTUBE !== "disposable")
    return (
      <main className="mx-auto max-w-2xl p-5">
        <h1 className="text-3xl font-black">Pair this desktop</h1>
        <p role="status" className="mt-4">
          Desktop pairing is unavailable from this deployment.
        </p>
      </main>
    );
  // This nonsecret shell grants no authority; client access checks and each POST
  // enforce the same verified administrator or same-game organizer boundary.
  return <M4DesktopPairing key={id} id={id} />;
}
