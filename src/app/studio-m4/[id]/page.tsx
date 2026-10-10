import React from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { M4BroadcastManager } from "@/components/M4BroadcastManager";

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
        <h1 className="text-3xl font-black">Broadcast manager</h1>
        <p role="status" className="mt-4">
          Local YouTube control is unavailable from this deployment.
        </p>
      </main>
    );
  return <M4BroadcastManager key={id} id={id} />;
}
