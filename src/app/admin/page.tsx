import { redirect } from "next/navigation";
import { platformAdminContext } from "@/lib/providers/platform-admin";
import { PlatformAdmin } from "@/components/PlatformAdmin";
export default async function AdminPage() {
  const user = await platformAdminContext().catch(() => null);
  if (!user) redirect("/account");
  return <PlatformAdmin />;
}
