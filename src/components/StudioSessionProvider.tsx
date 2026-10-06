"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { requestStudioPresentation } from "@/lib/studio-presentation-client";
import {
  resolveStudioNavigation,
  sessionGamePath,
  shouldGuardStudioNavigation,
  studioNavigationRequestSchema,
  studioSessionBridge,
  studioSessionLabel,
  studioSessionSchema,
  stopStudioSession,
  type StudioSession,
} from "@/lib/studio-session";
import "./studio-session.css";

const Context = createContext<StudioSession | null>(null);
export const useStudioSession = () => useContext(Context);
type NavigationRequest = {
  gameId: string;
  href: string;
  nonce?: string;
  returnPath?: string;
};

export function StudioSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    router = useRouter();
  const [session, setSession] = useState<StudioSession | null>(null);
  const current = useRef(session);
  current.current = session;
  const [navigation, setNavigation] = useState<NavigationRequest | null>(null);
  const [switching, setSwitching] = useState(false);
  const pendingNavigation = useRef<NavigationRequest | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const previousPath = useRef(pathname);
  const previousUrl = useRef<string | null>(null);
  const allowedNavigation = useRef(false);
  const decideRef = useRef<
    (decision: "continue" | "pause" | "stay") => Promise<void>
  >(async () => {});
  function open(request: NavigationRequest) {
    if (pendingNavigation.current) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    pendingNavigation.current = request;
    setNavigation(request);
    setError("");
  }
  function close() {
    pendingNavigation.current = null;
    setNavigation(null);
    setError("");
    previousFocus.current?.focus();
  }
  useEffect(() => {
    if (!studioSessionBridge()) return;
    const receive = (event: Event) => {
      const value = studioSessionSchema.safeParse(
        (event as CustomEvent).detail,
      );
      if (value.success) {
        current.current = value.data;
        setSession(value.data);
      }
    };
    const nativeNavigation = (event: Event) => {
      const value = studioNavigationRequestSchema.safeParse(
        (event as CustomEvent).detail,
      );
      if (!value.success) return;
      if (
        !current.current?.active ||
        current.current.gameId !== value.data.gameId
      )
        return;
      try {
        const href = new URL(value.data.href, location.origin);
        if (href.origin !== location.origin || href.username || href.password)
          return;
        open({ ...value.data, href: href.href });
      } catch {}
    };
    window.addEventListener("studio-session-status", receive);
    window.addEventListener("studio-navigation-request", nativeNavigation);
    studioSessionBridge()?.postMessage({ type: "studio-session-observe" });
    return () => {
      window.removeEventListener("studio-session-status", receive);
      window.removeEventListener("studio-navigation-request", nativeNavigation);
    };
  }, []);
  useEffect(() => {
    if (!studioSessionBridge()) return;
    studioSessionBridge()?.postMessage({ type: "studio-session-observe" });
    const previous = previousPath.current;
    const returnUrl = previousUrl.current;
    previousPath.current = pathname;
    previousUrl.current = location.pathname + location.search + location.hash;
    // Consume the approved transition even if authentication redirects it.
    if (allowedNavigation.current && previous !== pathname) {
      allowedNavigation.current = false;
      return;
    }
    // Browser Back and programmatic client navigation have no anchor click.
    // The persistent sender keeps running while the same choice is reviewed.
    if (
      previous !== pathname &&
      !pendingNavigation.current &&
      current.current?.gameId &&
      shouldGuardStudioNavigation(
        current.current,
        previous,
        new URL(pathname, location.origin),
      )
    ) {
      open({
        gameId: current.current.gameId,
        href: location.href,
        returnPath: returnUrl || previous,
      });
    }
  }, [pathname]);
  useEffect(() => {
    if (!studioSessionBridge()) return;
    const clicked = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      try {
        const destination = new URL(anchor.href, location.origin);
        if (
          destination.origin !== location.origin ||
          destination.username ||
          destination.password ||
          !shouldGuardStudioNavigation(current.current, pathname, destination)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        open({ gameId: current.current!.gameId!, href: destination.href });
      } catch {}
    };
    document.addEventListener("click", clicked, true);
    return () => document.removeEventListener("click", clicked, true);
  }, [pathname]);
  useEffect(() => {
    if (!navigation && !switching) return;
    (
      dialog.current?.querySelector<HTMLElement>("button:not(:disabled)") ||
      dialog.current
    )?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        if (switching) {
          setSwitching(false);
          setError("");
          previousFocus.current?.focus();
        } else void decideRef.current("stay");
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      if (!buttons?.length) {
        event.preventDefault();
        dialog.current?.focus();
        return;
      }
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trap);
    };
  }, [navigation, switching, pending]);
  async function decide(decision: "continue" | "pause" | "stay") {
    if (pending || !navigation) return;
    setPending(true);
    setError("");
    const request = navigation;
    try {
      if (request.nonce) {
        await resolveStudioNavigation(
          { gameId: request.gameId, nonce: request.nonce, href: request.href },
          decision,
        );
        close();
      } else if (decision === "stay") {
        if (request.returnPath) {
          allowedNavigation.current = true;
          router.push(request.returnPath);
        }
        close();
      } else {
        if (
          current.current?.gameId !== request.gameId ||
          !current.current.active
        )
          throw Error(
            "The active Studio game changed. Stay here and check its status.",
          );
        if (decision === "pause") {
          const receipt = await requestStudioPresentation(
            request.gameId,
            "hold",
          );
          if (receipt.presentation?.mode !== "hold")
            throw Error(
              "Studio did not confirm the pause card. Stay here and try again.",
            );
        }
        const destination = new URL(request.href, location.origin);
        close();
        if (!request.returnPath) {
          allowedNavigation.current = true;
          router.push(
            destination.pathname + destination.search + destination.hash,
          );
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Studio could not confirm this action. Stay here and try again.",
      );
    } finally {
      setPending(false);
    }
  }
  decideRef.current = decide;
  const showBanner =
    session?.active &&
    session.gameId &&
    !sessionGamePath(pathname, session.gameId);
  const viewedGame = pathname.match(/^\/score\/([0-9a-f-]{36})$/i)?.[1];
  const canSwitch = Boolean(
    viewedGame &&
    session?.active &&
    session.gameId &&
    viewedGame !== session.gameId &&
    !session.outputActive &&
    !session.live &&
    !session.busy &&
    ["idle", "stopped", "failed"].includes(session.streaming),
  );
  async function switchGame() {
    if (pending || !canSwitch || !session?.gameId) return;
    setPending(true);
    setError("");
    try {
      await stopStudioSession(session.gameId);
      // A full reload repeats the scoring page's authenticated game-ready event.
      location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not switch Studio games. Return to the active game and try again.",
      );
      setPending(false);
    }
  }
  return (
    <Context.Provider value={session}>
      {showBanner && (
        <aside
          className="studio-session-banner"
          aria-label="Active Studio game"
        >
          <span className="studio-session-title">
            {session.title || "Active game"}
          </span>
          <StudioSessionIndicator returnLink />
          {canSwitch && (
            <button
              className="btn-secondary"
              onClick={(event) => {
                previousFocus.current = event.currentTarget;
                setError("");
                setSwitching(true);
              }}
            >
              Switch Studio to this game
            </button>
          )}
        </aside>
      )}
      {children}
      {navigation && (
        <div className="studio-session-overlay">
          <div
            ref={dialog}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="studio-leave-title"
            aria-describedby="studio-leave-description"
            className="studio-session-dialog"
          >
            <h2 id="studio-leave-title">Leave the game screen?</h2>
            <p id="studio-leave-description">
              Keep broadcasting while you use other pages, or show viewers the
              temporary pause screen. Studio must stay open.
            </p>
            {error && (
              <p role="alert" className="studio-session-error">
                {error}
              </p>
            )}
            <div className="studio-session-dialog-actions">
              <button
                className="btn"
                disabled={pending || session?.busy}
                onClick={() => void decide("continue")}
              >
                Continue broadcast
              </button>
              <button
                className="btn-secondary"
                disabled={pending || session?.busy || !session?.canHoldStream}
                onClick={() => void decide("pause")}
              >
                Pause broadcast
              </button>
              <button
                className="btn-secondary"
                disabled={pending}
                onClick={() => void decide("stay")}
              >
                Stay here
              </button>
            </div>
            {pending && <p role="status">Confirming your choice…</p>}
          </div>
        </div>
      )}
      {switching && (
        <div className="studio-session-overlay">
          <div
            ref={dialog}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="studio-switch-title"
            aria-describedby="studio-switch-description"
            className="studio-session-dialog"
          >
            <h2 id="studio-switch-title">Switch Studio to this game?</h2>
            <p id="studio-switch-description">
              This stops the current game&apos;s camera preview and microphone
              so you can connect cameras for this game. The other game&apos;s
              score and YouTube link are saved.
            </p>
            {error && (
              <p role="alert" className="studio-session-error">
                {error}
              </p>
            )}
            <div className="studio-session-dialog-actions">
              <button
                className="btn"
                disabled={pending || !canSwitch}
                onClick={() => void switchGame()}
              >
                Switch Studio game
              </button>
              <button
                className="btn-secondary"
                disabled={pending}
                onClick={() => {
                  setSwitching(false);
                  setError("");
                  previousFocus.current?.focus();
                }}
              >
                Cancel
              </button>
            </div>
            {pending && <p role="status">Switching Studio game…</p>}
          </div>
        </div>
      )}
    </Context.Provider>
  );
}

export function StudioSessionIndicator({
  gameId,
  returnLink = false,
}: {
  gameId?: string;
  returnLink?: boolean;
}) {
  const session = useStudioSession();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  if (
    !session?.active ||
    !session.gameId ||
    (gameId && session.gameId !== gameId)
  )
    return null;
  const held = session.presentation === "hold";
  async function presentation() {
    if (pending || !session?.gameId) return;
    setPending(true);
    setError("");
    try {
      const receipt = await requestStudioPresentation(
        session.gameId,
        held ? "resume" : "hold",
      );
      if (receipt.presentation?.mode !== (held ? "live" : "hold"))
        throw Error("Studio did not confirm the broadcast change. Try again.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not change the broadcast. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="studio-session-controls">
      <span
        role="status"
        aria-live="polite"
        className="studio-session-badge"
        data-live={session.live && session.outputActive && !held}
      >
        {studioSessionLabel(session)}
      </span>
      {returnLink && (
        <Link href={`/score/${session.gameId}`} className="btn-secondary">
          Return to game
        </Link>
      )}
      {session.outputActive &&
        session.canHoldStream &&
        !["preparing-end", "ended"].includes(session.presentation) && (
          <button
            className="btn-secondary"
            disabled={pending || session.busy}
            onClick={() => void presentation()}
          >
            {pending
              ? "Please wait…"
              : held
                ? "Resume broadcast"
                : "Pause broadcast"}
          </button>
        )}
      {error && (
        <p role="alert" className="studio-session-error">
          {error}
        </p>
      )}
    </div>
  );
}
