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

export function StudioStatusArea() {
  const messages = useContext(MessagesContext);
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="btn-secondary min-h-11"
        onClick={() => dialog.current?.showModal()}
      >
        Status Log
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
      </dialog>
    </>
  );
}
