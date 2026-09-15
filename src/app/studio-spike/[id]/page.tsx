import { DirectMediaSpike } from "@/components/DirectMediaSpike";
export default async function StudioSpike({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DirectMediaSpike id={id} side="receiver" />;
}
