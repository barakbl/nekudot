import type { SymmetryTool } from "./tool";
import index from "./symmetry.json";

// Each tool .ts names its menu glyph (icon) and how to construct itself (create).
// symmetry.json is the ordered index (name/file/label/info) - the panel + navbar
// mode order follow it. Add a tool by writing its .ts and adding one JSON row;
// nothing here changes. Mirrors brushes/registry.ts.
type ToolModule = {
  icon: string;
  create: () => SymmetryTool;
};

const modules = import.meta.glob<ToolModule>("./tools/*.ts", { eager: true });

type IndexEntry = { name: string; file: string; label: string; info?: string };
const INDEX = index as IndexEntry[];

export type SymmetryToolDef = {
  name: string; // id + storage namespace
  label: string; // display name (panel + navbar)
  info?: string;
  icon: string; // menu glyph (inline SVG)
  create: () => SymmetryTool;
};

function moduleFor(file: string): ToolModule {
  const mod = modules["./tools/" + file];
  if (!mod || typeof mod.create !== "function")
    throw new Error(`symmetry tool module not found or invalid: ${file}`);
  return mod;
}

// One entry per tool - the single source of truth for the mode picker, the
// navbar combo and the controller's tool instances.
export const SYMMETRY_TOOL_DEFS: SymmetryToolDef[] = INDEX.map((e) => {
  const mod = moduleFor(e.file);
  return { name: e.name, label: e.label, info: e.info, icon: mod.icon, create: mod.create };
});
