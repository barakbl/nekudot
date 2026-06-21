import { z } from "zod";
import { clampColors, makeId, normalizeHex, type Palette } from "./palette";

// Import GIMP palette (.gpl) files. Format:
//   GIMP Palette
//   Name: My Palette
//   Columns: 16
//   # a comment
//   255   0   0	Red
//     0 255   0	Green
// The first line must be the "GIMP Palette" magic; then optional Name:/Columns:
// headers, "#" comments, and "R G B [name]" colour rows (0-255, whitespace-sep).
//
// Validation is per-row with zod and skip-on-error: a malformed colour row is
// dropped, the valid ones are salvaged (mirrors the store's sanitize approach).
// Returns null only when it isn't a GPL file or yields no usable colours.

const ChannelSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) => v.toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function parseGpl(text: string, fallbackName = "Imported"): Palette | null {
  const lines = text.split(/\r?\n/);
  // Magic line: strip a leading BOM / any non-letter noise, then compare.
  const magic = (lines[0] ?? "").toLowerCase().replace(/[^a-z ]+/g, "").trim();
  if (magic !== "gimp palette") return null;

  let name = fallbackName;
  const colors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const nameMatch = /^name:\s*(.+)$/i.exec(trimmed);
    if (nameMatch) {
      const n = nameMatch[1].trim();
      if (n) name = n;
      continue;
    }
    if (/^columns:/i.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    const parsed = ChannelSchema.safeParse({
      r: Number(parts[0]),
      g: Number(parts[1]),
      b: Number(parts[2]),
    });
    if (!parsed.success) continue; // skip on error
    colors.push(toHex(parsed.data.r, parsed.data.g, parsed.data.b));
  }

  const clamped = clampColors(colors);
  if (!clamped.length) return null;
  return { id: makeId(), name, colors: clamped };
}

// Serialize a palette to GIMP .gpl text (the inverse of parseGpl), for export /
// download. Emits "R G B<tab>#hex" rows, right-aligned to the conventional width.
// parseGpl(toGpl(p)) round-trips the name + colours.
export function toGpl(palette: { name: string; colors: readonly string[] }): string {
  const pad = (v: number) => String(v).padStart(3);
  const lines = [
    "GIMP Palette",
    `Name: ${palette.name || "Palette"}`,
    `Columns: ${palette.colors.length}`,
    "#",
  ];
  for (const c of palette.colors) {
    const n = normalizeHex(c);
    if (!n) continue;
    const r = parseInt(n.slice(1, 3), 16);
    const g = parseInt(n.slice(3, 5), 16);
    const b = parseInt(n.slice(5, 7), 16);
    lines.push(`${pad(r)} ${pad(g)} ${pad(b)}\t${n}`);
  }
  return lines.join("\n") + "\n";
}
