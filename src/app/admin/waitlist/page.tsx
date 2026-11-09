import { redirect } from "next/navigation";
import { platformAdminContext } from "@/lib/providers/platform-admin";
import { WaitlistAdmin } from "@/components/WaitlistAdmin";
export default async function WaitlistPage() {
  if (!(await platformAdminContext().catch(() => null))) redirect("/account");
  return <WaitlistAdmin />;
}
