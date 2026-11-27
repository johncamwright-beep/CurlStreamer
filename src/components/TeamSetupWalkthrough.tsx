"use client";

import { useEffect, useState, type ReactNode } from "react";

export function TeamSetupWalkthrough({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const storageKey = `curlcast-team-setup-walkthrough-dismissed:${organizationId}`;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === "1");
    } catch {
      /* Storage may be disabled for this browser. */
    }
  }, [storageKey]);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      /* Dismiss for the current page even if the browser cannot save it. */
    }
  }

  if (dismissed) return null;
  return (
    <section className="dashboard-setup-walkthrough" aria-label="Team setup">
      <details>
        <summary>Complete your team setup – walkthrough</summary>
        <div className="dashboard-setup-content">{children}</div>
      </details>
      <button
        className="dashboard-setup-dismiss"
        type="button"
        onClick={dismiss}
      >
        Dismiss
      </button>
    </section>
  );
}
