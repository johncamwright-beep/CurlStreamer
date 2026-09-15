import { notFound } from "next/navigation";
import { z } from "zod";
import { M2CameraSlot } from "@/components/M2CameraSlot";
export default async function StudioM2Camera({
  params,
}: {
  params: Promise<{ id: string; cameraRole: string }>;
}) {
  const { id, cameraRole } = await params;
  const role = z.enum(["camera-home", "camera-away"]).safeParse(cameraRole);
  if (!role.success || !z.uuid().safeParse(id).success) notFound();
  return (
    <main>
      <M2CameraSlot
        key={`${id}:${role.data}`}
        id={id}
        side="camera"
        cameraRole={role.data}
      />
    </main>
  );
}
