import { notFound } from "next/navigation";
import { z } from "zod";
import { M3Program } from "@/components/M3Program";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <M3Program key={id} id={id} />;
}
