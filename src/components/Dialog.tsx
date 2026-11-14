// Modal dialog: role="dialog" + aria-modal, labelled by its title, focus trap (Tab / Shift+Tab cycle), Esc closes,
// focus returns to the element that opened it. Rendered in a portal so a sticky/stacking ancestor cannot clip it.
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  open: boolean;
  title: string;
  /** Called on Esc and on a click on the backdrop. */
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, title, onClose, children, testId }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog when it opens and restore it to the opener when it closes.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    if (!firstItem || !lastItem) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    // Wrap around at both ends so focus never leaves the dialog.
    if (event.shiftKey && (active === firstItem || active === panelRef.current)) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && active === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  };

  return createPortal(
    // The backdrop click is a mouse convenience only (role="presentation"); keyboard users close with Esc (on the panel).
    <div
      role="presentation"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* The key handler implements the dialog pattern (Esc + focus trap); a dialog is allowed to handle keys. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-lg bg-white p-5 text-slate-900 shadow-xl"
      >
        <h2 id={titleId} className="mb-3 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
