import { notFound } from "next/navigation";
import { z } from "zod";
import { StudioSetup } from "@/components/StudioSetup";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return (
    <StudioSetup
      key={id}
      id={id}
      directCameras={process.env.CURLCAST_M1_DIRECT_SPIKE === "disposable"}
      pairing={process.env.CURLCAST_M4_LOCAL_YOUTUBE === "disposable"}
    />
  );
}
