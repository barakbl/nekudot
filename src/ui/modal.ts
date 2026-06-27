// The shared shell for the confirm.ts dialogs (error / prompt / checklist /
// typed-confirm / confirm). Each one used to hand-build the same plumbing: a
// `confirm-modal app-modal` backdrop holding a `confirm-card`, appended to the
// body, a close() that removes the backdrop and the keydown listener, an
// outside-click-to-close, and a document keydown listener. This owns all of that;
// the caller fills `card`, wires its buttons to `close`, and sets `onKey` /
// `onBackdropClose` for the per-dialog Escape/Enter and outside-click behaviour.

import { trapFocus, type FocusTrap } from "./focus-trap";

export type ModalClose = (then?: () => void) => void;

export interface Modal {
  readonly backdrop: HTMLElement;
  readonly card: HTMLElement;
  // Removes the modal and its keydown listener, then runs `then` (e.g. an
  // onConfirm / onCancel callback) once it is gone.
  readonly close: ModalClose;
  // Per-dialog key handling (Escape / Enter). Set after building the card.
  onKey?: (e: KeyboardEvent) => void;
  // What a click on the backdrop (outside the card) does. Defaults to close().
  onBackdropClose?: () => void;
}

let titleSeq = 0;

export function createModal(): Modal {
  // Capture the trigger now, before the caller moves focus into the card, so we
  // can hand it back on close.
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const backdrop = document.createElement("div");
  backdrop.className = "confirm-modal app-modal";
  const card = document.createElement("div");
  card.className = "confirm-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.tabIndex = -1;
  backdrop.appendChild(card);

  let trap: FocusTrap | null = null;

  const keyListener = (e: KeyboardEvent): void => modal.onKey?.(e);
  const close: ModalClose = (then) => {
    document.removeEventListener("keydown", keyListener);
    if (trap) trap.release();
    else previouslyFocused?.focus?.();
    backdrop.remove();
    then?.();
  };
  const modal: Modal = { backdrop, card, close };

  backdrop.addEventListener("click", (e) => {
    if (e.target !== backdrop) return;
    if (modal.onBackdropClose) modal.onBackdropClose();
    else close();
  });
  document.addEventListener("keydown", keyListener);
  document.body.appendChild(backdrop);

  // The caller fills the card synchronously after we return; wait a microtask,
  // then name the dialog from its heading and arm the focus trap.
  queueMicrotask(() => {
    if (!backdrop.isConnected) return; // closed before we got here
    const heading = card.querySelector<HTMLElement>("h1, h2, h3");
    if (heading) {
      if (!heading.id) heading.id = `modal-title-${++titleSeq}`;
      card.setAttribute("aria-labelledby", heading.id);
    }
    trap = trapFocus(card, previouslyFocused);
  });

  return modal;
}
