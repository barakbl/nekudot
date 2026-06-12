import type { ConnectionBase, ConnectionDeps, ConnectionSpec } from "./base";
import connectionsIndex from "./connections.json";

// connections.json is grouped: { "Classic": [...], "More": [...], "Custom": [] }.
// A data-only style (Airy, String Art, Shading, Arc, Lace) declares its icon +
// slider values in its JSON row and runs on the generic class (classic.ts); a
// code style (Fur) points `file` at its own module, which supplies behaviour
// (drawHair…) and may export its own `icon`. The "Custom" group is empty in the
// file — user-saved presets live in IndexedDB and are injected via
// setCustomPresets() at runtime.
type ConnectionModule = {
  default: new (deps: ConnectionDeps, spec: ConnectionSpec) => ConnectionBase;
  icon?: string;
};

const modules = import.meta.glob<ConnectionModule>("./*.ts", { eager: true });

type GroupedSpecs = Record<string, ConnectionSpec[]>;
const GROUPS = connectionsIndex as GroupedSpecs;
// Built-in group display order (Custom is rendered separately, first when filled).
const BUILTIN_GROUP_ORDER = Object.keys(GROUPS).filter((g) => g !== "Custom");
const BUILTIN_SPECS: ConnectionSpec[] = BUILTIN_GROUP_ORDER.flatMap((g) => GROUPS[g] ?? []);

const BUILTIN_BY_NAME = new Map(BUILTIN_SPECS.map((s) => [s.name, s]));

let customSpecs: ConnectionSpec[] = [];
let specByName = new Map<string, ConnectionSpec>();

function rebuild(): void {
  specByName = new Map();
  for (const s of BUILTIN_SPECS) specByName.set(s.name, s);
  for (const s of customSpecs) specByName.set(s.name, s); // custom wins on name clash
}
rebuild();

// Replace the Custom group (loaded from IndexedDB). Rebuilds the lookup so
// createConnection() and connectionGroups() see the new presets. Normalized
// here too, so no caller can slip an un-normalized spec into the registry.
export function setCustomPresets(specs: ConnectionSpec[]): void {
  customSpecs = normalizeCustomSpecs(specs);
  rebuild();
}

export function isBuiltinStyle(name: string): boolean {
  return BUILTIN_BY_NAME.has(name);
}

// A built-in style's menu glyph (from its JSON row, else its module export).
function builtinIcon(name: string): string {
  const s = BUILTIN_BY_NAME.get(name);
  return s ? (s.icon ?? moduleFor(s.file).icon ?? "") : "";
}

// icon markup → built-in style name, to infer `base` for legacy custom specs
// (saved before `base` existed, when the built-in icon was copied verbatim
// into the spec). Exact match only — anything else is untrusted input.
const BASE_BY_ICON = new Map<string, string>();
for (const s of BUILTIN_SPECS) {
  const icon = builtinIcon(s.name);
  if (icon && !BASE_BY_ICON.has(icon)) BASE_BY_ICON.set(icon, s.name);
}

// Normalize custom specs from any untrusted source (imported .preset file,
// the persisted IDB array, a save commit). The spec's own `icon` is NEVER
// kept — it feeds an innerHTML sink, so markup here would be stored XSS.
// `base` survives only if it names a real built-in style; legacy specs
// without one get it inferred from an exact icon match, anything else just
// loses its glyph (fallback icon).
export function normalizeCustomSpecs(specs: ConnectionSpec[]): ConnectionSpec[] {
  return specs.map(({ icon, ...rest }) => ({
    ...rest,
    base:
      rest.base && isBuiltinStyle(rest.base)
        ? rest.base
        : icon !== undefined
          ? BASE_BY_ICON.get(icon)
          : undefined,
  }));
}

export function hasConnection(name: string): boolean {
  return specByName.has(name);
}

// Whether a spec's `file` resolves to a real connection class module — used to
// validate imported presets so a file can't point at an arbitrary/missing module.
export function isConnectionFile(file: string): boolean {
  return typeof modules["./" + file]?.default === "function";
}

function moduleFor(file: string): ConnectionModule {
  const mod = modules["./" + file];
  if (!mod || typeof mod.default !== "function")
    throw new Error(`connection module not found or invalid: ${file}`);
  return mod;
}

function iconFor(spec: ConnectionSpec): string {
  // A spec with `base` is a custom preset: its glyph comes from the built-in
  // parent, never from the spec itself (see normalizeCustomSpecs).
  if (spec.base) return builtinIcon(spec.base);
  return spec.icon ?? moduleFor(spec.file).icon ?? "";
}

export type ConnectionDef = {
  name: string;
  label: string;
  info: string;
  icon: string;
};
export type ConnectionGroup = { group: string; defs: ConnectionDef[] };

function toDef(spec: ConnectionSpec): ConnectionDef {
  return {
    name: spec.name,
    label: spec.label ?? spec.name.charAt(0).toUpperCase() + spec.name.slice(1),
    info: spec.info ?? "",
    icon: iconFor(spec),
  };
}

// Groups for the navbar Connecting combo, in display order: Custom always first
// (even when empty — it carries the import/export actions), then the built-in
// groups (Classic, More).
export function connectionGroups(): ConnectionGroup[] {
  const out: ConnectionGroup[] = [{ group: "Custom", defs: customSpecs.map(toDef) }];
  for (const g of BUILTIN_GROUP_ORDER) {
    const specs = GROUPS[g];
    if (specs?.length) out.push({ group: g, defs: specs.map(toDef) });
  }
  return out;
}

export function createConnection(name: string, deps: ConnectionDeps): ConnectionBase {
  const spec = specByName.get(name);
  if (!spec) throw new Error(`unknown connection: ${name}`);
  const Cls = moduleFor(spec.file).default;
  return new Cls(deps, spec);
}
