"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function GameActionsMenu({ children }: { children: ReactNode }) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);

  useEffect(() => {
    const menu = disclosure.current;
    if (!menu) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        menu.open &&
        !menu.querySelector("dialog[open]") &&
        !event.composedPath().includes(menu)
      )
        menu.open = false;
    };
    const listenWhileOpen = () => {
      if (menu.open) document.addEventListener("pointerdown", closeOutside);
      else document.removeEventListener("pointerdown", closeOutside);
    };
    menu.addEventListener("toggle", listenWhileOpen);
    listenWhileOpen();
    return () => {
      menu.removeEventListener("toggle", listenWhileOpen);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, []);

  return (
    <details
      ref={disclosure}
      name="dashboard-game-actions"
      className="dashboard-more"
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          !event.currentTarget.open ||
          event.defaultPrevented ||
          (event.target instanceof Element && event.target.closest("dialog"))
        )
          return;
        event.preventDefault();
        event.currentTarget.open = false;
        trigger.current?.focus();
      }}
    >
      <summary ref={trigger} aria-label="More actions">
        <span aria-hidden="true">•••</span>
      </summary>
      <div className="dashboard-more-popover">{children}</div>
    </details>
  );
}
