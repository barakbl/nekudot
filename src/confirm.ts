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
  const backdrop = document.createElement("div");
  backdrop.className = "confirm-modal";
  const card = document.createElement("div");
  card.className = "confirm-card";

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
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  const close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") close();
  };
  ok.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  ok.focus();
}

export function showConfirm(opts: ConfirmOptions): void {
  const backdrop = document.createElement("div");
  backdrop.className = "confirm-modal";

  const card = document.createElement("div");
  card.className = "confirm-card";

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
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  const close = (then?: () => void) => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    then?.();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close(opts.onCancel);
    else if (e.key === "Enter") {
      close(opts.destructive ? opts.onCancel : opts.onConfirm);
    }
  };

  cancel.addEventListener("click", () => close(opts.onCancel));
  confirm.addEventListener("click", () => close(opts.onConfirm));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close(opts.onCancel);
  });
  document.addEventListener("keydown", onKey);

  (opts.destructive ? cancel : confirm).focus();
}
