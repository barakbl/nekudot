import { createPanel } from "../ui/panel";

export type FolderBox = {
  el: HTMLElement;
  toggle: () => void;
  // Re-render after connection / current-file state changes.
  refresh: () => void;
};

// What the panel needs from the folder-sync controller (all read live so the
// panel reflects the latest state on every refresh).
export type FolderBoxHost = {
  isConnected: () => boolean;
  folderName: () => string | null;
  pendingFolderName: () => string | null;
  currentFile: () => string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSaveArtwork: () => void;
  onSaveSettings: () => void;
  onLoadSettings: () => void;
};

// The Local folder window (Chrome folder sync): one home for connecting a folder
// and saving/restoring there, so the feature isn't split between App settings and
// the canvas menu. Built only when the File System Access API is available; it's
// also the natural home for the future gallery (browse + open folder pieces).
export function createFolderBox(host: FolderBoxHost): FolderBox {
  const { panel } = createPanel({
    className: "layers-box folder-box",
    title: "Local folder",
  });

  const body = document.createElement("div");
  body.className = "appset-body";
  panel.appendChild(body);

  const desc = (text: string) => {
    const el = document.createElement("div");
    el.className = "appset-desc";
    el.textContent = text;
    return el;
  };
  const row = (labelText: string, control: HTMLElement) => {
    const r = document.createElement("div");
    r.className = "appset-row";
    const l = document.createElement("span");
    l.className = "appset-label";
    l.textContent = labelText;
    r.append(l, control);
    return r;
  };
  const btn = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "appset-io-btn";
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  const actions = (...buttons: HTMLButtonElement[]) => {
    const wrap = document.createElement("div");
    wrap.className = "appset-io-actions";
    wrap.append(...buttons);
    return wrap;
  };
  const valueText = (text: string) => {
    const el = document.createElement("span");
    el.className = "appset-folder-name";
    el.textContent = text;
    return el;
  };

  const refresh = () => {
    body.replaceChildren();
    if (!host.isConnected()) {
      const pending = host.pendingFolderName();
      if (pending) {
        // Folder is remembered but the browser cleared its permission; offer a
        // one-click reconnect (onConnect re-grants the stored handle, no re-pick).
        const head = actions(btn("Reconnect", host.onConnect));
        head.prepend(valueText(pending));
        body.append(
          desc("This folder needs permission again. Reconnect to keep saving here."),
          row("Folder", head),
        );
        return;
      }
      body.append(
        desc(
          "Save your settings and artwork to a folder on this computer - no download each time.",
        ),
        row("Folder", actions(btn("Connect folder", host.onConnect))),
      );
      return;
    }

    const folderHead = actions(btn("Disconnect", host.onDisconnect));
    folderHead.prepend(valueText(host.folderName() ?? "Connected"));

    // Show which file the canvas is bound to (or that it isn't yet) next to the
    // Save button, so a save's destination is never a mystery.
    const file = host.currentFile();
    const drawingHead = actions(btn("Save to folder", host.onSaveArtwork));
    drawingHead.prepend(valueText(file ?? "Not saved here yet"));

    body.append(
      row("Folder", folderHead),
      row("This drawing", drawingHead),
      row(
        "Settings",
        actions(
          btn("Back up", host.onSaveSettings),
          btn("Restore", host.onLoadSettings),
        ),
      ),
    );
  };
  refresh();

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };
  return { el: panel, toggle, refresh };
}
