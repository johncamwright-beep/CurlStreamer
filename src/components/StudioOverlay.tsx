"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function StudioOverlay({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
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
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          className="btn-secondary min-h-11"
          type="button"
          onClick={onClose}
        >
          Close
        </button>
      </header>
      <div className="studio-overlay-content">{children}</div>
    </dialog>
  );
}
