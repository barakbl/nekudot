import { createModal } from "./ui/modal";

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

// Single-button error modal. Used when a validation/load step fails.
export function showError(message: string, title = "Couldn't load"): void {
  const modal = createModal();
  const { card, close } = modal;

  const header = document.createElement("div");
  header.className = "confirm-header";
  const icon = document.createElement("span");
  icon.className = "confirm-icon";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<path d="M12 3 L22 20 L2 20 Z" fill="#d9534f"/>' +
    '<rect x="11" y="9" width="2" height="6" fill="#fff" rx="0.5"/>' +
    '<circle cx="12" cy="17.5" r="1.1" fill="#fff"/>' +
    "</svg>";
  header.appendChild(icon);
  const h = document.createElement("h3");
  h.textContent = title;
  header.appendChild(h);
  card.appendChild(header);

  const msg = document.createElement("p");
  msg.textContent = message;
  card.appendChild(msg);

  const actions = document.createElement("div");
  actions.className = "confirm-actions";
  const ok = document.createElement("button");
  ok.className = "confirm-btn confirm-btn-primary";
  ok.textContent = "OK";
  actions.appendChild(ok);
  card.appendChild(actions);

  ok.addEventListener("click", () => close());
  modal.onKey = (e) => {
    if (e.key === "Escape" || e.key === "Enter") close();
  };
  ok.focus();
}

export type PromptOptions = {
  title?: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel?: () => void;
};

// Single-line text prompt modal (the styled replacement for window.prompt).
// onConfirm fires with the trimmed value; an empty value keeps the modal open.
export function showPrompt(opts: PromptOptions): void {
  const modal = createModal();
  const { card, close } = modal;

  if (opts.title) {
    const header = document.createElement("div");
    header.className = "confirm-header";
    const title = document.createElement("h3");
    title.textContent = opts.title;
    header.appendChild(title);
    card.appendChild(header);
  }
  if (opts.message) {
    const msg = document.createElement("p");
    msg.textContent = opts.message;
    card.appendChild(msg);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "confirm-input";
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.value = opts.initial ?? "";
  card.appendChild(input);

  const actions = document.createElement("div");
  actions.className = "confirm-actions";
  const cancel = document.createElement("button");
  cancel.className = "confirm-btn confirm-btn-cancel";
  cancel.textContent = opts.cancelLabel ?? "Cancel";
  const confirm = document.createElement("button");
  confirm.className = "confirm-btn confirm-btn-primary";
  confirm.textContent = opts.confirmLabel ?? "Save";
  actions.append(cancel, confirm);
  card.appendChild(actions);

  const submit = () => {
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    close(() => opts.onConfirm(value));
  };
  cancel.addEventListener("click", () => close(opts.onCancel));
  confirm.addEventListener("click", submit);
  modal.onKey = (e) => {
    if (e.key === "Escape") close(opts.onCancel);
    else if (e.key === "Enter") submit();
  };
  modal.onBackdropClose = () => close(opts.onCancel);
  input.focus();
  input.select();
}

export type ChecklistItem = { id: string; label: string; checked?: boolean };
export type ChecklistOptions = {
  title?: string;
  message?: string;
  items: ChecklistItem[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (selectedIds: string[]) => void;
  onCancel?: () => void;
};

// A modal list of checkboxes (the styled replacement for ad-hoc pickers).
// onConfirm fires with the ids of the ticked items; Confirm is disabled when
// nothing is ticked. Items default to ticked unless `checked: false`.
export function showChecklist(opts: ChecklistOptions): void {
  const modal = createModal();
  const { card, close } = modal;

  if (opts.title) {
    const header = document.createElement("div");
    header.className = "confirm-header";
    const title = document.createElement("h3");
    title.textContent = opts.title;
    header.appendChild(title);
    card.appendChild(header);
  }
  if (opts.message) {
    const msg = document.createElement("p");
    msg.textContent = opts.message;
    card.appendChild(msg);
  }

  const list = document.createElement("div");
  list.className = "confirm-checklist";
  const boxes: HTMLInputElement[] = [];
  for (const item of opts.items) {
    const row = document.createElement("label");
    row.className = "confirm-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = item.checked !== false;
    box.dataset.id = item.id;
    const span = document.createElement("span");
    span.textContent = item.label;
    row.append(box, span);
    list.appendChild(row);
    boxes.push(box);
  }
  card.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "confirm-actions";
  const cancel = document.createElement("button");
  cancel.className = "confirm-btn confirm-btn-cancel";
  cancel.textContent = opts.cancelLabel ?? "Cancel";
  const confirm = document.createElement("button");
  confirm.className = "confirm-btn confirm-btn-primary";
  confirm.textContent = opts.confirmLabel ?? "Export";
  actions.append(cancel, confirm);
  card.appendChild(actions);

  const selected = () => boxes.filter((b) => b.checked).map((b) => b.dataset.id ?? "");
  const sync = () => {
    confirm.disabled = selected().length === 0;
  };
  for (const b of boxes) b.addEventListener("change", sync);
  sync();

  cancel.addEventListener("click", () => close(opts.onCancel));
  confirm.addEventListener("click", () => {
    if (selected().length === 0) return;
    const ids = selected();
    close(() => opts.onConfirm(ids));
  });
  modal.onKey = (e) => {
    if (e.key === "Escape") close(opts.onCancel);
  };
  modal.onBackdropClose = () => close(opts.onCancel);
}

export type TypedConfirmOptions = {
  title?: string;
  message: string;
  // The user must type this (case-insensitive, trimmed) to enable Confirm, so a
  // stray Enter/click can't trigger an irreversible action.
  requireText: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
};

// The gate for showTypedConfirm: does the typed value match the required word?
// Case-insensitive and trimmed, so "Yes" / " yes " all pass for requireText
// "yes". Exported so the gate semantics can be unit-tested without a DOM.
export function matchesRequiredText(value: string, required: string): boolean {
  return value.trim().toLowerCase() === required.trim().toLowerCase();
}

// A destructive confirm gated behind typing a specific word (e.g. "yes"). The
// Confirm button stays disabled until the input matches requireText.
export function showTypedConfirm(opts: TypedConfirmOptions): void {
  const modal = createModal();
  const { card, close } = modal;

  const header = document.createElement("div");
  header.className = "confirm-header";
  const icon = document.createElement("span");
  icon.className = "confirm-icon";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<path d="M12 3 L22 20 L2 20 Z" fill="#d9534f"/>' +
    '<rect x="11" y="9" width="2" height="6" fill="#fff" rx="0.5"/>' +
    '<circle cx="12" cy="17.5" r="1.1" fill="#fff"/>' +
    "</svg>";
  header.appendChild(icon);
  if (opts.title) {
    const h = document.createElement("h3");
    h.textContent = opts.title;
    header.appendChild(h);
  }
  card.appendChild(header);

  const msg = document.createElement("p");
  msg.textContent = opts.message;
  card.appendChild(msg);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "confirm-input";
  input.autocapitalize = "off";
  input.autocomplete = "off";
  if (opts.placeholder) input.placeholder = opts.placeholder;
  card.appendChild(input);

  const actions = document.createElement("div");
  actions.className = "confirm-actions";
  const cancel = document.createElement("button");
  cancel.className = "confirm-btn confirm-btn-cancel";
  cancel.textContent = opts.cancelLabel ?? "Cancel";
  const confirm = document.createElement("button");
  confirm.className = "confirm-btn confirm-btn-destructive";
  confirm.textContent = opts.confirmLabel ?? "Confirm";
  confirm.disabled = true;
  actions.append(cancel, confirm);
  card.appendChild(actions);

  const matches = () => matchesRequiredText(input.value, opts.requireText);
  const sync = () => {
    confirm.disabled = !matches();
  };
  input.addEventListener("input", sync);

  const submit = () => {
    if (!matches()) {
      input.focus();
      return;
    }
    close(opts.onConfirm);
  };
  cancel.addEventListener("click", () => close(opts.onCancel));
  confirm.addEventListener("click", submit);
  modal.onKey = (e) => {
    if (e.key === "Escape") close(opts.onCancel);
    else if (e.key === "Enter") submit();
  };
  modal.onBackdropClose = () => close(opts.onCancel);
  input.focus();
}

export function showConfirm(opts: ConfirmOptions): void {
  const modal = createModal();
  const { card, close } = modal;

  if (opts.title || opts.destructive) {
    const header = document.createElement("div");
    header.className = "confirm-header";

    if (opts.destructive) {
      const icon = document.createElement("span");
      icon.className = "confirm-icon";
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
        '<path d="M12 3 L22 20 L2 20 Z" fill="#f0ad4e"/>' +
        '<rect x="11" y="9" width="2" height="6" fill="#1c1d20" rx="0.5"/>' +
        '<circle cx="12" cy="17.5" r="1.1" fill="#1c1d20"/>' +
        "</svg>";
      header.appendChild(icon);
    }

    if (opts.title) {
      const title = document.createElement("h3");
      title.textContent = opts.title;
      header.appendChild(title);
    }

    card.appendChild(header);
  }

  const msg = document.createElement("p");
  msg.textContent = opts.message;
  card.appendChild(msg);

  const actions = document.createElement("div");
  actions.className = "confirm-actions";

  const cancel = document.createElement("button");
  cancel.className = "confirm-btn confirm-btn-cancel";
  cancel.textContent = opts.cancelLabel ?? "Cancel";

  const confirm = document.createElement("button");
  confirm.className = `confirm-btn ${opts.destructive ? "confirm-btn-destructive" : "confirm-btn-primary"}`;
  confirm.textContent = opts.confirmLabel ?? "Confirm";

  actions.appendChild(cancel);
  actions.appendChild(confirm);
  card.appendChild(actions);

  cancel.addEventListener("click", () => close(opts.onCancel));
  confirm.addEventListener("click", () => close(opts.onConfirm));
  modal.onKey = (e) => {
    if (e.key === "Escape") close(opts.onCancel);
    else if (e.key === "Enter") {
      close(opts.destructive ? opts.onCancel : opts.onConfirm);
    }
  };
  modal.onBackdropClose = () => close(opts.onCancel);

  (opts.destructive ? cancel : confirm).focus();
}
