// Ports of the sketchy / web / shaded brushes of Harmony by mr.doob (Ricardo
// Cabello) - https://github.com/mrdoob/harmony (GPL-3-or-later). Those three
// Classic styles (Sketchy, Web, Shaded) are pure data: they add no behaviour,
// only the JSON dial values in connections.json that reproduce each Harmony brush.
import { ConnectionBase } from "./base";

// The generic, data-only connection: it adds no behaviour - its icon and slider
// values come from connections.json. Every plain connection style (Sketchy, Web,
// Shaded, Lace, Bloom…) is an instance of this, configured by its JSON entry.
// Only connections that need custom code (e.g. Fur's drawHair) get their own file.
export default class ClassicConnection extends ConnectionBase {}
