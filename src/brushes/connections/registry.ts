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

let customSpecs: ConnectionSpec[] = [];
let specByName = new Map<string, ConnectionSpec>();

function rebuild(): void {
  specByName = new Map();
  for (const s of BUILTIN_SPECS) specByName.set(s.name, s);
  for (const s of customSpecs) specByName.set(s.name, s); // custom wins on name clash
}
rebuild();

// Replace the Custom group (loaded from IndexedDB). Rebuilds the lookup so
// createConnection() and connectionGroups() see the new presets.
export function setCustomPresets(specs: ConnectionSpec[]): void {
  customSpecs = specs;
  rebuild();
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
