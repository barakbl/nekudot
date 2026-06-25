import { describe, it, expect } from "vitest";
import {
  encodeConnectMap,
  decodeConnectMap,
  type ConnectMap,
} from "../src/connecting-types";

// A ConnectMap persists as a single string. Map ids are UUIDs precisely so they
// can never collide with the "selected"/"none" sentinels - if one did, a pinned
// map would silently decode as "follow the selected map" or "no trail" and lose
// the pin on reload. These lock the round-trip and the non-collision.
describe("ConnectMap string codec", () => {
  it("round-trips every kind losslessly", () => {
    const cases: ConnectMap[] = [
      { kind: "selected" },
      { kind: "none" },
      { kind: "map", mapId: crypto.randomUUID() },
    ];
    for (const c of cases) {
      expect(decodeConnectMap(encodeConnectMap(c))).toEqual(c);
    }
  });

  it("a UUID map id never decodes as a sentinel", () => {
    for (let i = 0; i < 50; i++) {
      const id = crypto.randomUUID();
      expect(id).not.toBe("selected");
      expect(id).not.toBe("none");
      expect(
        decodeConnectMap(encodeConnectMap({ kind: "map", mapId: id })),
      ).toEqual({ kind: "map", mapId: id });
    }
  });

  it("the sentinel strings decode to their kinds, not a pinned map", () => {
    expect(decodeConnectMap("selected")).toEqual({ kind: "selected" });
    expect(decodeConnectMap("none")).toEqual({ kind: "none" });
  });
});
