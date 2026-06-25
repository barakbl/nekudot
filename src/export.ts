import type { LayerManager } from "./layered/manager";
import type { IRenderer } from "./renderer";

export type ExportOptions = {
  backgroundColor: string;
  prefix?: string;
};

export function flattenLayers(
  manager: LayerManager,
  opts: { backgroundColor: string },
): IRenderer {
  const flat = manager.createMatchingRenderer();
  if (opts.backgroundColor !== "transparent") {
    flat.fillBackground(opts.backgroundColor);
  }
  const ordered = [...manager.all].sort(
    (a, b) => a.config.index - b.config.index,
  );
  for (const layer of ordered) {
    flat.drawSource(layer.renderer, layer.config.opacity / 100);
  }
  return flat;
}

export async function exportArt(
  manager: LayerManager,
  opts: ExportOptions,
): Promise<"downloaded" | "empty"> {
  const flat = flattenLayers(manager, { backgroundColor: opts.backgroundColor });
  const blob = await flat.toBlob("image/png");
  if (!blob) return "empty";
  triggerDownload(blob, `${opts.prefix ?? "art"}_${timestamp()}.png`);
  return "downloaded";
}

// Default caption sent with the shared image (the native share sheet passes this
// to the chosen app; some apps — notably Instagram — ignore prefilled captions).
export const SHARE_TEXT = "My art made with Nekudot #nekudot";

// Outcome of a share, so the caller can give the right feedback.
//   shared     — handed to the OS share sheet (user picks Instagram/X/FB/…)
//   downloaded — no Web Share for files (e.g. desktop): saved PNG + copied caption
//   cancelled  — user dismissed the share sheet
//   empty      — nothing to flatten
export type ShareResult = "shared" | "downloaded" | "cancelled" | "empty";

// Flatten the art to a PNG and hand it to the platform's native share sheet via
// the Web Share API (the only web mechanism that carries the actual image into
// Instagram/X/Facebook). Falls back to a download + clipboard caption where file
// sharing isn't supported (most desktop browsers). Stays fully client-side.
export async function shareArt(
  manager: LayerManager,
  opts: ExportOptions,
): Promise<ShareResult> {
  const flat = flattenLayers(manager, { backgroundColor: opts.backgroundColor });
  const blob = await flat.toBlob("image/png");
  if (!blob) return "empty";
  const file = new File([blob], `${opts.prefix ?? "nekudot"}_${timestamp()}.png`, {
    type: "image/png",
  });
  const data: ShareData = { files: [file], text: SHARE_TEXT, title: "Nekudot" };

  if (typeof navigator.canShare === "function" && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      // User dismissed the sheet → done; any other error → fall back below.
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }

  triggerDownload(blob, file.name);
  try {
    await navigator.clipboard?.writeText(SHARE_TEXT);
  } catch {
    // clipboard may be unavailable / denied; the download still happened.
  }
  return "downloaded";
}

export function timestamp(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const date = `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${date}_${time}`;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
