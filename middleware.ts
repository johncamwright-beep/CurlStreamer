import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseConfig } from "@/lib/supabase/config";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = publicSupabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        const replacement = NextResponse.next({ request });
        response.headers.forEach((value, name) =>
          replacement.headers.set(name, value),
        );
        values.forEach(({ name, value, options }) =>
          replacement.cookies.set(name, value, options),
        );
        response = replacement;
      },
    },
  });
  // getUser verifies identity with Auth; getSession must not authorize requests.
  await supabase.auth.getUser();
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
