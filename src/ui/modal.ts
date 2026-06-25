// The shared shell for the confirm.ts dialogs (error / prompt / checklist /
// typed-confirm / confirm). Each one used to hand-build the same plumbing: a
// `confirm-modal app-modal` backdrop holding a `confirm-card`, appended to the
// body, a close() that removes the backdrop and the keydown listener, an
// outside-click-to-close, and a document keydown listener. This owns all of that;
// the caller fills `card`, wires its buttons to `close`, and sets `onKey` /
// `onBackdropClose` for the per-dialog Escape/Enter and outside-click behaviour.

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

export function createModal(): Modal {
  const backdrop = document.createElement("div");
  backdrop.className = "confirm-modal app-modal";
  const card = document.createElement("div");
  card.className = "confirm-card";
  backdrop.appendChild(card);

  const keyListener = (e: KeyboardEvent): void => modal.onKey?.(e);
  const close: ModalClose = (then) => {
    document.removeEventListener("keydown", keyListener);
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
  return modal;
}
