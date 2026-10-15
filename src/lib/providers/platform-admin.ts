import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
export async function platformAdminContext() {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  if (!user?.email_confirmed_at) return null;
  const { data, error } = await createAdminSupabaseClient().rpc(
    "is_platform_admin",
    { p_user: user.id },
  );
  if (error) throw Error("Platform administration unavailable");
  return data === true ? user : null;
}
export function sameOriginWrite(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
