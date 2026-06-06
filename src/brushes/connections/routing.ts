import {
  encodeConnectMap,
  type ConnectMap,
  type ConnectMode,
  type ConnectingFlat,
} from "../../connecting-types";

// Connecting routing presets (where a stroke reads/stores neighbours and whether
// it connects). Independent of the art-style presets — the settings panel shows
// these as their own preset row, and brushes apply "classic" routing on New art.
export type RoutingSettings = {
  connecting_from_map: ConnectMap;
  connecting_to_map: ConnectMap;
  connecting_mode: ConnectMode;
};

export const ROUTING_PRESETS = {
  classic: {
    connecting_from_map: { kind: "selected" },
    connecting_to_map: { kind: "selected" },
    connecting_mode: "both",
  },
  no_connect: {
    connecting_from_map: { kind: "selected" },
    connecting_to_map: { kind: "none" }, // no trail
    connecting_mode: "none", // connect to nothing
  },
} as const satisfies Record<string, RoutingSettings>;
export type RoutingPresetName = keyof typeof ROUTING_PRESETS;

// Flatten to the string values the select-based UI / setKey() carry.
export function flattenRouting(p: RoutingSettings): ConnectingFlat {
  return {
    connecting_from_map: encodeConnectMap(p.connecting_from_map),
    connecting_to_map: encodeConnectMap(p.connecting_to_map),
    connecting_mode: p.connecting_mode,
  };
}
