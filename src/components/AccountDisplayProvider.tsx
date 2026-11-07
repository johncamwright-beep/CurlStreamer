"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Display = {
  logo: string | null;
  platformAdmin: boolean;
  coachAccess: boolean;
};
const empty: Display = { logo: null, platformAdmin: false, coachAccess: false };
const Context = createContext({
  ...empty,
  signedIn: false,
  refresh: (_force = false) => {},
  seedLogo: (_logo: string | null) => {},
});

// Presentation only. Every destination and mutation still authorizes on the server.
// Root-layout state survives client navigation; nothing is persisted across logins.
export function AccountDisplayProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [display, setDisplay] = useState<Display>(empty);
  const generation = useRef(0);
  const checkedAt = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const identity = useRef<string | null | undefined>(undefined);
  const reset = useCallback(() => {
    generation.current++;
    pending.current?.abort();
    pending.current = null;
    checkedAt.current = 0;
    setDisplay(empty);
  }, []);
  useEffect(() => {
    if (pathname === "/login" || pathname === "/signup") {
      reset();
      setSignedIn(false);
    }
  }, [pathname, reset]);
  const seedLogo = useCallback((logo: string | null) => {
    setDisplay((previous) =>
      previous.logo === logo ? previous : { ...previous, logo },
    );
  }, []);
  const refresh = useCallback((force = false) => {
    if (pending.current) {
      if (!force) return;
      // An explicit menu refresh must not be lost behind an older request.
      generation.current++;
      pending.current.abort();
      pending.current = null;
    }
    if (!force && Date.now() - checkedAt.current < 60_000) return;
    const controller = new AbortController();
    pending.current = controller;
    const version = generation.current;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const read = async (
      url: string,
      project: (data: Record<string, unknown>) => Partial<Display>,
    ) => {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        if (version === generation.current && !controller.signal.aborted)
          setDisplay((previous) => ({ ...previous, ...project(data) }));
      } catch {
        /* Keep known display state during a temporary connection failure. */
      }
    };
    void Promise.all([
      read("/api/account/appearance", (data) => ({
        logo:
          typeof data?.logo === "string" &&
          (data.logo.startsWith("/branding/") ||
            data.logo.startsWith("https://"))
            ? data.logo
            : null,
      })),
      read("/api/account/navigation", (data) => ({
        platformAdmin: data?.platformAdmin === true,
      })),
      read("/api/curlcoach/access", (data) => ({
        coachAccess: data?.enabled === true,
      })),
    ]).finally(() => {
      clearTimeout(timeout);
      if (version === generation.current) {
        pending.current = null;
        checkedAt.current = controller.signal.aborted ? 0 : Date.now();
      }
    });
  }, []);
  // Server-action logins update cookies without necessarily emitting a browser
  // auth event. Read the local session after navigation, without a getUser round trip.
  useEffect(() => {
    if (pathname === "/login" || pathname === "/signup") return;
    let active = true;
    try {
      void createBrowserSupabaseClient()
        .auth.getSession()
        .then(({ data }) => {
          if (!active) return;
          const next = data.session?.user.id ?? null;
          if (identity.current !== undefined && identity.current !== next)
            reset();
          identity.current = next;
          setSignedIn(Boolean(next));
          if (next) refresh();
        })
        .catch(() => {});
    } catch {
      /* No configured authentication in local previews. */
    }
    return () => {
      active = false;
    };
  }, [pathname, refresh, reset]);
  useEffect(() => {
    let unsubscribe = () => {};
    try {
      const client = createBrowserSupabaseClient();
      const { data } = client.auth.onAuthStateChange((event, session) => {
        const next = session?.user.id ?? null;
        if (
          (identity.current !== undefined && identity.current !== next) ||
          event === "SIGNED_OUT"
        ) {
          reset();
        }
        identity.current = next;
        setSignedIn(Boolean(next));
        if (next) refresh();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      /* Local previews can run without Supabase configuration. */
    }
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", focus);
      generation.current++;
      pending.current?.abort();
      pending.current = null;
    };
  }, [refresh, reset]);
  return (
    <Context.Provider value={{ ...display, signedIn, refresh, seedLogo }}>
      {children}
    </Context.Provider>
  );
}

export const useAccountDisplay = () => useContext(Context);
