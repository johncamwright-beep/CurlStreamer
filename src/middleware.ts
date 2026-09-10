import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseConfig } from "@/lib/supabase/config";

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const teamHost = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.curlstreamer\.app$/.exec(host);
  if (teamHost && teamHost[1] !== "www") {
    if (request.nextUrl.pathname !== "/")
      return new NextResponse("Not found", { status: 404 });
    const destination = request.nextUrl.clone();
    destination.pathname = "/teams/" + teamHost[1];
    return NextResponse.rewrite(destination);
  }
  let response = NextResponse.next({ request });
  const { url, key } = publicSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        const replacement = NextResponse.next({ request });
        // Keep the newly generated request-cookie overrides after refresh.
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
