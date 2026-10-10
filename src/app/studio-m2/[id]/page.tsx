import { notFound } from "next/navigation";
import { z } from "zod";
import { M2Receiver } from "@/components/M2Receiver";
export default async function StudioM2({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <M2Receiver id={id} />;
}
