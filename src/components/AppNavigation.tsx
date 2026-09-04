"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/app/account/actions";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { hasOrganizerAccess, hasScoringAccess } from "@/lib/access-session";
import {
  readCurrentGame,
  CURRENT_GAME_KEY,
  type CurrentGameSelection,
} from "@/lib/current-game";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type NavLink = { href: string; label: string; icon: AppIconName };
const plan: NavLink[] = [
  { href: "/dashboard", label: "Games", icon: "game" },
  { href: "/games/new", label: "Schedule a game", icon: "calendar" },
  { href: "/seasons", label: "Seasons & events", icon: "list" },
  { href: "/opponents", label: "Opponents", icon: "opponent" },
];

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
  const [current, setCurrent] = useState<CurrentGameSelection | null>(null);

  useEffect(() => {
    if (knownSignedIn !== undefined) return setSignedIn(knownSignedIn);
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
      setSignedIn(false);
    }
  }, [knownSignedIn]);

  useEffect(() => {
    const update = () => {
      let selected = readCurrentGame(localStorage);
      if (gameId) {
        const access = hasOrganizerAccess(localStorage, gameId)
          ? "organizer"
          : hasScoringAccess(localStorage, gameId)
            ? "scorer"
            : null;
        if (!access && selected?.id === gameId) {
          localStorage.removeItem(CURRENT_GAME_KEY);
          selected = null;
        }
      }
      setCurrent(selected);
    };
    update();
    addEventListener("storage", update);
    addEventListener("curlcast-current-game", update);
    return () => {
      removeEventListener("storage", update);
      removeEventListener("curlcast-current-game", update);
    };
  }, [gameId, pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const triggerElement = trigger.current;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return setOpen(false);
      if (event.key !== "Tab" || !panel.current) return;
      const controls = [
        ...panel.current.querySelectorAll<HTMLElement>("a, button"),
      ];
      if (!controls.length) return;
      const first = controls[0],
        last = controls.at(-1)!;
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

  const gameLinks: NavLink[] = current
    ? [
        ...(current.access === "organizer"
          ? [
              {
                href: `/games/${current.id}`,
                label: "Game control",
                icon: "control" as const,
              },
            ]
          : []),
        { href: `/score/${current.id}`, label: "Scoring", icon: "score" },
        {
          href: `/broadcast/${current.id}`,
          label: "Broadcast",
          icon: "broadcast",
        },
        ...(current.access === "organizer"
          ? [
              {
                href: `/games/${current.id}/edit`,
                label: "Edit schedule",
                icon: "edit" as const,
              },
            ]
          : []),
      ]
    : [];
  const renderLinks = (links: NavLink[]) =>
    links.map(({ href, label, icon }) => {
      const currentRoute = pathname === href;
      return (
        <li key={href}>
          <Link
            className="app-navigation-link"
            href={href}
            aria-current={currentRoute ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <AppIcon name={icon} />
            <span>{label}</span>
          </Link>
        </li>
      );
    });

  return (
    <div className={`app-navigation ${className}`} data-testid="app-navigation">
      <button
        ref={trigger}
        type="button"
        className="app-navigation-trigger"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">☰</span>
        <span className="sr-only">Menu</span>
      </button>
      {open && (
        <button
          type="button"
          className="app-navigation-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setOpen(false)}
        />
      )}
      <nav
        ref={panel}
        id={panelId}
        className={`app-navigation-panel ${open ? "is-open" : ""}`}
        aria-label="CurlStreamer navigation"
      >
        <div className="app-navigation-brand">
          <strong>CurlCast</strong>
          <button
            type="button"
            className="app-navigation-close"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        {signedIn ? (
          <>
            <section>
              <h2 className="app-navigation-heading">Plan &amp; Schedule</h2>
              <ul>{renderLinks(plan)}</ul>
            </section>
            <section className="app-navigation-current">
              <h2 className="app-navigation-heading">Current Game</h2>
              {current ? (
                <>
                  <strong className="block px-3 text-sm">
                    {current.title}
                  </strong>
                  <span className="block px-3 pb-2 text-xs text-slate-400">
                    {current.scheduledLabel}
                  </span>
                  <ul>{renderLinks(gameLinks)}</ul>
                </>
              ) : (
                <div className="px-3 text-sm text-slate-400">
                  <p>No game selected</p>
                  <Link
                    className="inline-flex min-h-11 items-center text-cyan-300"
                    href="/dashboard"
                  >
                    Choose a game
                  </Link>
                </div>
              )}
            </section>
            <section className="app-navigation-account">
              <h2 className="app-navigation-heading">Account</h2>
              <ul>
                {renderLinks([
                  { href: "/account", label: "Account", icon: "account" },
                ])}
              </ul>
              <form action={signOut}>
                <button className="app-navigation-link w-full text-left">
                  <AppIcon name="logout" />
                  Sign out
                </button>
              </form>
            </section>
          </>
        ) : (
          <ul>
            {renderLinks([
              { href: "/login", label: "Sign in", icon: "account" },
            ])}
          </ul>
        )}
      </nav>
    </div>
  );
}
