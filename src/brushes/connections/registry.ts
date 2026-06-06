import type { ConnectionBase, ConnectionDeps, ConnectionSpec } from "./base";
import connectionsIndex from "./connections.json";

// connections.json is the source of truth. A data-only style (Classic, Web, Arc,
// Shaded, Lace) declares its icon + slider values right in the JSON and runs on
// the generic class (classic.ts) — add one by writing a JSON row, no .ts needed.
// A code connection (Fur) points its `file` at its own module, which supplies the
// behaviour (drawHair…) and may export its own `icon`.
type ConnectionModule = {
  default: new (deps: ConnectionDeps, spec: ConnectionSpec) => ConnectionBase;
  icon?: string;
};

const modules = import.meta.glob<ConnectionModule>("./*.ts", { eager: true });
const INDEX = connectionsIndex as ConnectionSpec[];
const byName = new Map(INDEX.map((e) => [e.name, e] as const));

function moduleFor(file: string): ConnectionModule {
  const mod = modules["./" + file];
  if (!mod || typeof mod.default !== "function")
    throw new Error(`connection module not found or invalid: ${file}`);
  return mod;
}

// The menu glyph for a style — from its JSON entry, else its module (Fur).
function iconFor(spec: ConnectionSpec): string {
  return spec.icon ?? moduleFor(spec.file).icon ?? "";
}

export type ConnectionDef = {
  name: string;
  label: string;
  info: string;
  icon: string;
};

// One entry per connection — drives the navbar Connecting combo (order, labels,
// icons, tooltips). `label` defaults to the capitalized name.
export const CONNECTION_DEFS: ConnectionDef[] = INDEX.map((e) => ({
  name: e.name,
  label: e.label ?? e.name.charAt(0).toUpperCase() + e.name.slice(1),
  info: e.info ?? "",
  icon: iconFor(e),
}));

export const CONNECTION_ICONS: Record<string, string> = Object.fromEntries(
  CONNECTION_DEFS.map((d) => [d.name, d.icon]),
);

export function connectionNames(): string[] {
  return INDEX.map((e) => e.name);
}

export function createConnection(name: string, deps: ConnectionDeps): ConnectionBase {
  const spec = byName.get(name);
  if (!spec) throw new Error(`unknown connection: ${name}`);
  const Cls = moduleFor(spec.file).default;
  return new Cls(deps, spec);
}
