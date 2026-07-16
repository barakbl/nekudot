import type { Pixel } from "../neighbor-finder";

// Ordered point add/remove ops per neighbour map, keyed by stable map id. A delta
// undo rebuilds each cloud by replaying these forward (never inverting). Holds
// LIVE Pixel refs and serializes values at read time, so a colour assigned after
// addPixel() (the Color Pen) rides along. Record-only: nothing drains it yet.

export type MapPoint = { x: number; y: number; color?: string };
export type MapOp = { mapId: string; op: "add" | "remove"; points: MapPoint[] };
export type MapJournalSnapshot = { ops: MapOp[]; truncated: boolean };

// Past this many buffered points, drop oldest ops and flag `truncated` to stay
// memory-bounded while nothing drains the journal. The per-stroke consumer takes
// every push, so it never trips in practice; when it does, fall back to a keyframe.
const POINT_CAP = 100_000;

type LiveOp = { mapId: string; op: "add" | "remove"; points: Pixel[] };

function serialize(o: LiveOp): MapOp {
  return {
    mapId: o.mapId,
    op: o.op,
    // Match collectMapPixels' shape: omit colour when unset.
    points: o.points.map((p) =>
      p.color ? { x: p.x, y: p.y, color: p.color } : { x: p.x, y: p.y },
    ),
  };
}

export class MapJournal {
  private ops: LiveOp[] = [];
  private buffered = 0;
  private truncated = false;

  recordAdd(mapId: string, points: readonly Pixel[]): void {
    this.record("add", mapId, points);
  }

  recordRemove(mapId: string, points: readonly Pixel[]): void {
    this.record("remove", mapId, points);
  }

  private record(
    op: "add" | "remove",
    mapId: string,
    points: readonly Pixel[],
  ): void {
    if (points.length === 0) return;
    this.ops.push({ mapId, op, points: points.slice() });
    this.buffered += points.length;
    while (this.buffered > POINT_CAP && this.ops.length > 1) {
      const dropped = this.ops.shift();
      if (dropped) this.buffered -= dropped.points.length;
      this.truncated = true;
    }
  }

  // Non-destructive read: serializes live-ref values now (post-mutation).
  peek(): MapJournalSnapshot {
    return { ops: this.ops.map(serialize), truncated: this.truncated };
  }

  // Read and reset - the atomic cut a capture takes at push time.
  take(): MapJournalSnapshot {
    const snap = this.peek();
    this.reset();
    return snap;
  }

  reset(): void {
    this.ops = [];
    this.buffered = 0;
    this.truncated = false;
  }
}

// Rebuild each map's point-value multiset by replaying ops forward from empty.
// Removes match by value (a co-located twin drops one instance) - all the
// multiset cares about.
export function replayMapPoints(
  ops: readonly MapOp[],
): Map<string, MapPoint[]> {
  const perMap = new Map<string, MapPoint[]>();
  for (const op of ops) {
    const arr = perMap.get(op.mapId) ?? [];
    if (op.op === "add") {
      arr.push(...op.points);
    } else {
      for (const pt of op.points) {
        const i = arr.findIndex(
          (q) => q.x === pt.x && q.y === pt.y && q.color === pt.color,
        );
        if (i >= 0) arr.splice(i, 1);
      }
    }
    perMap.set(op.mapId, arr);
  }
  return perMap;
}
