"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
export function AccountNavigation() {
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const client = createBrowserSupabaseClient();
    client.auth.getUser().then(({ data }) => setLoggedIn(Boolean(data.user)));
    const { data } = client.auth.onAuthStateChange((_event, session) =>
      setLoggedIn(Boolean(session?.user)),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <Link
      className="inline-flex min-h-11 items-center text-cyan-300"
      href={loggedIn ? "/account" : "/login"}
    >
      {loggedIn ? "My account" : "Sign in"}
    </Link>
  );
}
