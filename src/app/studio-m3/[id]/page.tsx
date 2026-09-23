import { notFound } from "next/navigation";
import { z } from "zod";
import { M3Operator } from "@/components/M3Operator";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <M3Operator key={id} id={id} />;
}
