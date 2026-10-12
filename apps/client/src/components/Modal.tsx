import { useLayoutEffect, useRef, type ReactNode } from "react";

type Props = {
  label: string;
  dismissible: boolean;
  onClose: () => void;
  children: ReactNode;
};

const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';

export function Modal({ label, dismissible, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const el = dialog.current!;
    const opener = document.activeElement;
    el.showModal();
    (el.querySelector<HTMLElement>("[data-modal-initial-focus]") ?? el.querySelector<HTMLElement>(focusable) ?? el).focus();
    return () => {
      el.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const el = dialog.current!;
    const active = document.activeElement;
    if (!el.contains(active) || (active instanceof HTMLElement && active.matches(":disabled"))) el.focus();
  });

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={label}
      aria-modal="true"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          if (dismissible) onClose();
          return;
        }
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(focusable)];
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}
