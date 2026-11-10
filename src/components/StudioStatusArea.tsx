"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { studioSessionBridge } from "@/lib/studio-session";

const StatusContext = createContext<
  ((key: string, message?: string) => void) | null
>(null);
type Entry = { message: string; at: number };
const MessagesContext = createContext<Entry[]>([]);

export function StudioStatusProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [messages, setMessages] = useState<Entry[]>([]);
  const latest = useRef<Record<string, string>>({});
  const update = useCallback((key: string, message?: string) => {
    if (!message) {
      delete latest.current[key];
      return;
    }
    if (latest.current[key] === message) return;
    latest.current[key] = message;
    setMessages((previous) =>
      [{ message, at: Date.now() }, ...previous].slice(0, 100),
    );
  }, []);
  if (!enabled) return children;
  return (
    <StatusContext.Provider value={update}>
      <MessagesContext.Provider value={messages}>
        {children}
      </MessagesContext.Provider>
    </StatusContext.Provider>
  );
}

/** Keep operational notices out of controls; retain a fallback on standalone pages. */
export function StudioStatusMessage({
  message,
  role,
  source,
}: {
  message?: string | null;
  role?: "status" | "alert";
  source?: string;
}) {
  const update = useContext(StatusContext);
  const key = useId();
  useEffect(() => {
    update?.(
      key,
      message ? (source ? `${source}: ${message}` : message) : undefined,
    );
  }, [update, key, message, source]);
  useEffect(() => () => update?.(key), [update, key]);
  return !update && message ? <p role={role}>{message}</p> : null;
}

export function StudioStatusArea({ gameId }: { gameId: string }) {
  const messages = useContext(MessagesContext);
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [forceCloseGame, setForceCloseGame] = useState<string>();
  const latestMessage = messages[0];
  useEffect(() => {
    const bridge = studioSessionBridge();
    if (!bridge) return;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setForceCloseGame(
        detail?.gameId === gameId && detail.canForceClose === true
          ? gameId
          : undefined,
      );
    };
    window.addEventListener("studio-recovery-status", receive);
    bridge.postMessage({ type: "studio-session-observe" });
    return () => window.removeEventListener("studio-recovery-status", receive);
  }, [gameId]);
  useEffect(() => {
    if (!latestMessage) return;
    setVisible(true);
    const timeout = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timeout);
  }, [latestMessage]);
  return (
    <>
      <button
        type="button"
        className="btn-secondary min-h-11 studio-status-preview"
        aria-label="Status Log"
        onClick={() => dialog.current?.showModal()}
      >
        <span>Status Log</span>
        <span className="studio-status-latest" role="status">
          {visible ? latestMessage?.message : ""}
        </span>
      </button>
      <dialog
        ref={dialog}
        className="studio-status-dialog"
        aria-labelledby="studio-status-title"
      >
        <header>
          <h2 id="studio-status-title">Status Log</h2>
          <button
            type="button"
            className="btn-secondary min-h-11"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </header>
        <div className="studio-status-entries" role="log" aria-live="polite">
          {messages.length ? (
            messages.map((entry, index) => (
              <p key={`${entry.at}-${index}`}>
                <time>{new Date(entry.at).toLocaleTimeString()}</time>{" "}
                {entry.message}
              </p>
            ))
          ) : (
            <p>No status messages yet.</p>
          )}
        </div>
        {forceCloseGame === gameId && (
          <button
            type="button"
            className="btn-secondary mt-3 min-h-11 border-red-700 text-red-200"
            onClick={() =>
              studioSessionBridge()?.postMessage({
                type: "studio-force-close",
                gameId,
              })
            }
          >
            Force close Studio
          </button>
        )}
      </dialog>
    </>
  );
}
