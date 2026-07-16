import { describe, it, expect, beforeEach } from "vitest";

import type { Pixel } from "../src/neighbor-finder";
import {
  MapJournal,
  type MapPoint,
  replayMapPoints,
} from "../src/layered/map-journal";
import type { LayerManager } from "../src/layered/manager";
import { makeSymmetryProxy } from "../src/symmetry/proxy";
import { IDENTITY, translate } from "../src/symmetry/transforms";
import { installDocumentStub, newManager } from "./_layer-manager-harness";

installDocumentStub();

// Compare two point lists as value-multisets (order-independent).
const ms = (pts: readonly MapPoint[]): string[] =>
  pts.map((p) => JSON.stringify(p)).sort();

// The collectMapPixels() multiset for the map with the given id.
const finderMultiset = (m: LayerManager, id: string): string[] => {
  const idx = m.allNeighborsMaps.findIndex((nm) => nm.config.id === id);
  return ms(m.collectMapPixels()[idx]?.pixels ?? []);
};

// The journal-replay multiset for that map, from empty.
const journalMultiset = (m: LayerManager, id: string): string[] => {
  const replay = replayMapPoints(m.mapJournal.peek().ops);
  return ms(replay.get(id) ?? []);
};

describe("MapJournal", () => {
  it("serializes live-ref values at read time (post-add colour rides along)", () => {
    const j = new MapJournal();
    const p: Pixel = { id: 0, x: 5, y: 5 };
    j.recordAdd("m1", [p]);
    p.color = "#abc"; // the Color Pen tags the point AFTER addPixel() returned
    expect(j.peek().ops).toEqual([
      { mapId: "m1", op: "add", points: [{ x: 5, y: 5, color: "#abc" }] },
    ]);
  });

  it("preserves op order and take() resets", () => {
    const j = new MapJournal();
    j.recordAdd("m1", [{ id: 0, x: 0, y: 0 }]);
    j.recordRemove("m1", [{ id: 0, x: 0, y: 0 }]);
    const taken = j.take();
    expect(taken.ops.map((o) => o.op)).toEqual(["add", "remove"]);
    expect(taken.truncated).toBe(false);
    expect(j.peek().ops).toEqual([]); // reset
  });

  it("ignores empty ops", () => {
    const j = new MapJournal();
    j.recordAdd("m1", []);
    expect(j.peek().ops).toEqual([]);
  });

  it("bounds memory past the cap and flags truncated", () => {
    const j = new MapJournal();
    const chunk = (n: number): Pixel[] =>
      Array.from({ length: n }, (_, i) => ({ id: i, x: i, y: 0 }));
    j.recordAdd("m", chunk(40_000));
    j.recordAdd("m", chunk(40_000));
    j.recordAdd("m", chunk(40_000)); // 120k > 100k cap -> drop the oldest op
    const snap = j.peek();
    expect(snap.truncated).toBe(true);
    expect(snap.ops.length).toBe(2);
  });
});

describe("replayMapPoints", () => {
  it("reproduces a multiset with add + remove", () => {
    const replay = replayMapPoints([
      { mapId: "m", op: "add", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { mapId: "m", op: "remove", points: [{ x: 1, y: 1 }] },
    ]);
    expect(ms(replay.get("m") ?? [])).toEqual(ms([{ x: 2, y: 2 }]));
  });

  it("remove-then-add of the same point nets one instance", () => {
    const replay = replayMapPoints([
      { mapId: "m", op: "add", points: [{ x: 3, y: 3 }] },
      { mapId: "m", op: "remove", points: [{ x: 3, y: 3 }] },
      { mapId: "m", op: "add", points: [{ x: 3, y: 3 }] },
    ]);
    expect(replay.get("m")).toEqual([{ x: 3, y: 3 }]);
  });

  it("a remove of a co-located twin drops just one instance", () => {
    const replay = replayMapPoints([
      { mapId: "m", op: "add", points: [{ x: 4, y: 4 }, { x: 4, y: 4 }] },
      { mapId: "m", op: "remove", points: [{ x: 4, y: 4 }] },
    ]);
    expect(replay.get("m")).toEqual([{ x: 4, y: 4 }]);
  });
});

describe("MapJournal tapped at the manager sinks", () => {
  let manager: LayerManager;
  let mapId: string;

  beforeEach(() => {
    manager = newManager();
    mapId = manager.allNeighborsMaps[0].config.id;
  });

  it("addPixel deposits replay to collectMapPixels", () => {
    manager.addPixel(10, 10);
    manager.addPixel(20, 20);
    expect(journalMultiset(manager, mapId)).toEqual(finderMultiset(manager, mapId));
    expect(finderMultiset(manager, mapId)).toEqual(
      ms([{ x: 10, y: 10 }, { x: 20, y: 20 }]),
    );
  });

  it("captures a colour assigned after addPixel (Color Pen)", () => {
    const px = manager.addPixel(30, 30);
    px.color = "#ff0000";
    expect(journalMultiset(manager, mapId)).toEqual(finderMultiset(manager, mapId));
    expect(finderMultiset(manager, mapId)).toEqual(
      ms([{ x: 30, y: 30, color: "#ff0000" }]),
    );
  });

  it("eraser remove-then-add in one stroke replays consistently", () => {
    manager.addPixel(10, 10);
    manager.addPixel(50, 50);
    manager.forgetPointsNear(10, 10, 5); // removes the (10,10) dot, records the victim
    manager.addPixel(10, 10); // re-deposit
    const ops = manager.mapJournal.peek().ops.map((o) => o.op);
    expect(ops).toEqual(["add", "add", "remove", "add"]); // order preserved
    expect(journalMultiset(manager, mapId)).toEqual(finderMultiset(manager, mapId));
    expect(finderMultiset(manager, mapId)).toEqual(
      ms([{ x: 50, y: 50 }, { x: 10, y: 10 }]),
    );
  });

  it("symmetry-mirrored deposits pass through the same sink", () => {
    const transforms = [IDENTITY, translate(100, 0, 1)];
    const proxy = makeSymmetryProxy(
      manager,
      () => transforms,
      () => 1,
      () => true,
    );
    proxy.addPixel(10, 10); // master (10,10) + mirror (110,10)
    expect(manager.mapJournal.peek().ops).toHaveLength(2);
    expect(journalMultiset(manager, mapId)).toEqual(finderMultiset(manager, mapId));
    expect(finderMultiset(manager, mapId)).toEqual(
      ms([{ x: 10, y: 10 }, { x: 110, y: 10 }]),
    );
  });

  it("keys by stable map id, surviving a map delete", () => {
    const mapB = manager.addNeighborsMap();
    const idA = mapId;
    const idB = mapB.config.id;
    manager.selectNeighborsMap(0);
    manager.addPixel(1, 1); // -> map A
    manager.selectNeighborsMap(1);
    manager.addPixel(2, 2); // -> map B
    manager.removeNeighborsMap(0); // map B's index shifts 1 -> 0

    const replay = replayMapPoints(manager.mapJournal.peek().ops);
    // Map B's ops still carry its own id, so replay matches its finder despite
    // the index shift; map A's ops remain under idA (not reassigned to B).
    expect(ms(replay.get(idB) ?? [])).toEqual(finderMultiset(manager, idB));
    expect(replay.get(idB)).toEqual([{ x: 2, y: 2 }]);
    expect(replay.get(idA)).toEqual([{ x: 1, y: 1 }]);
    expect(idA).not.toBe(idB);
  });

  it("addPixelToMap records under the target map's id", () => {
    const mapB = manager.addNeighborsMap();
    manager.selectNeighborsMap(0); // selected is A, but target B by id
    manager.addPixelToMap(mapB.config.id, 7, 7);
    expect(journalMultiset(manager, mapB.config.id)).toEqual(
      finderMultiset(manager, mapB.config.id),
    );
    expect(finderMultiset(manager, mapB.config.id)).toEqual(ms([{ x: 7, y: 7 }]));
  });
});
