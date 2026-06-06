import { ConnectionBase } from "./base";

// The generic, data-only connection: it adds no behaviour — its icon and slider
// values come from connections.json. Every plain connection style (Classic, Web,
// Arc, Shaded, Lace…) is an instance of this, configured by its JSON entry.
// Only connections that need custom code (e.g. Fur's drawHair) get their own file.
export default class ClassicConnection extends ConnectionBase {}
