"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/app/account/actions";
import { hasOrganizerAccess, hasScoringAccess } from "@/lib/access-session";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type GameAccess = "organizer" | "scorer" | "none";

export function AppNavigation({
  signedIn: knownSignedIn,
  gameId,
  className = "",
}: {
  signedIn?: boolean;
  gameId?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(knownSignedIn ?? false);
  const [gameAccess, setGameAccess] = useState<GameAccess>("none");

  useEffect(() => {
    if (knownSignedIn !== undefined) {
      setSignedIn(knownSignedIn);
      return;
    }
    try {
      const client = createBrowserSupabaseClient();
      void client.auth
        .getUser()
        .then(({ data }) => setSignedIn(Boolean(data.user)))
        .catch(() => setSignedIn(false));
      const { data } = client.auth.onAuthStateChange((_event, session) =>
        setSignedIn(Boolean(session?.user)),
      );
      return () => data.subscription.unsubscribe();
    } catch {
      // Account navigation is optional; anonymous game creation must stay usable.
      setSignedIn(false);
    }
  }, [knownSignedIn]);

  useEffect(() => {
    if (!gameId) return setGameAccess("none");
    if (hasOrganizerAccess(localStorage, gameId)) setGameAccess("organizer");
    else if (hasScoringAccess(localStorage, gameId)) setGameAccess("scorer");
    else setGameAccess("none");
  }, [gameId]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const triggerElement = trigger.current;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const controls = [
        ...panel.current.querySelectorAll<HTMLElement>("a, button"),
      ];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      triggerElement?.focus();
    };
  }, [open]);

  const links = [
    { href: "/", label: "CurlStreamer Home" },
    ...(signedIn
      ? [
          { href: "/dashboard", label: "Team Dashboard" },
          { href: "/seasons", label: "Seasons & Events" },
          { href: "/opponents", label: "Opponents" },
          { href: "/games/new", label: "Create a Game" },
          { href: "/account", label: "My Account" },
        ]
      : [{ href: "/login", label: "Sign In" }]),
    ...(gameId && gameAccess === "organizer"
      ? [
          { href: `/games/${gameId}`, label: "Game Setup" },
          { href: `/score/${gameId}`, label: "Scoring" },
          { href: `/broadcast/${gameId}`, label: "Broadcast" },
        ]
      : gameId && gameAccess === "scorer"
        ? [
            { href: `/score/${gameId}`, label: "Scoring" },
            { href: `/broadcast/${gameId}`, label: "Broadcast" },
          ]
        : []),
  ];

  return (
    <div className={`app-navigation ${className}`} data-testid="app-navigation">
      <button
        ref={trigger}
        type="button"
        className="app-navigation-trigger"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">☰</span>
        <span className="sr-only">Menu</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="app-navigation-backdrop"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
          />
          <nav
            ref={panel}
            id={panelId}
            className="app-navigation-panel"
            aria-label="CurlStreamer navigation"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <strong className="text-xl">CurlStreamer</strong>
              <button
                type="button"
                className="app-navigation-close"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <ul className="grid gap-2">
              {links.map(({ href, label }) => {
                const route = href.split("#")[0];
                const current = pathname === route && !href.includes("#");
                return (
                  <li key={`${href}-${label}`}>
                    <Link
                      className="app-navigation-link"
                      href={href}
                      aria-current={current ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {signedIn && (
              <form action={signOut} className="mt-2">
                <button className="app-navigation-link w-full text-left">
                  Sign Out
                </button>
              </form>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
