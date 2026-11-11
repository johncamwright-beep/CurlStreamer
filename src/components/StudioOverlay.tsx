"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function StudioOverlay({
  title,
  open,
  onClose,
  children,
  dismissible = true,
  showCloseButton = true,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  dismissible?: boolean;
  showCloseButton?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="studio-status-dialog studio-settings-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
        else onClose();
      }}
      onClose={onClose}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        {showCloseButton && (
          <button
            className="btn-secondary min-h-11"
            type="button"
            disabled={!dismissible}
            onClick={onClose}
          >
            Close
          </button>
        )}
      </header>
      <div className="studio-overlay-content">{children}</div>
    </dialog>
  );
}
