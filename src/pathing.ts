import * as THREE from 'three';
import { WORLD_HALF, type Obstacle } from './world';

export const PATHING = {
  /** Grid cell size in world units. Smaller = tighter paths, slower rebuilds. */
  cell: 0.5,
  /** Agent radius, for the straight-line (line of sight) check. */
  agentRadius: 0.35,
  /**
   * Clearance the grid adds around obstacles. Kept below agentRadius so narrow
   * but walkable gaps (e.g. the showcase ring) don't vanish between cell
   * centres; collision push-out handles the last bit.
   */
  gridClearance: 0.15,
  /** Minimum seconds between rebuilds while the target keeps moving. */
  rebuildEvery: 0.2,
};

/**
 * Flow field toward one target (the player): a grid of walking distances to
 * the target, rebuilt when the target changes cell. Any number of agents can
 * read a direction from it, so it costs the same for 3 zombies as for 300.
 * Where the target is in plain sight, agents just walk straight at it.
 */
export class FlowField {
  private readonly n: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Float64Array;
  private targetCell = -1;
  private sinceBuild = Infinity;
  private target = new THREE.Vector3();

  constructor(private obstacles: readonly Obstacle[]) {
    this.n = Math.ceil((WORLD_HALF * 2) / PATHING.cell);
    this.blocked = new Uint8Array(this.n * this.n);
    this.dist = new Float64Array(this.n * this.n).fill(Infinity);
    for (let iz = 0; iz < this.n; iz++) {
      for (let ix = 0; ix < this.n; ix++) {
        const { x, z } = this.centre(ix, iz);
        const hit = obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + PATHING.gridClearance);
        const edge = Math.abs(x) > WORLD_HALF - 1 || Math.abs(z) > WORLD_HALF - 1;
        this.blocked[iz * this.n + ix] = hit || edge ? 1 : 0;
      }
    }
  }

  /** Call every frame with the target position; rebuilds only when needed. */
  update(dt: number, target: THREE.Vector3): void {
    this.target.copy(target);
    this.sinceBuild += dt;
    const cell = this.index(target.x, target.z);
    if (cell !== this.targetCell && this.sinceBuild >= PATHING.rebuildEvery) {
      this.targetCell = cell;
      this.sinceBuild = 0;
      this.build(cell);
    }
  }

  /** Unit direction (y = 0) an agent at `pos` should walk to reach the target. */
  direction(pos: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    if (this.clearPath(pos, this.target)) return out.set(this.target.x - pos.x, 0, this.target.z - pos.z).normalize();

    // Downhill: the neighbouring cell closest (by walking distance) to the target.
    const ix = this.coord(pos.x);
    const iz = this.coord(pos.z);
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = ix + dx;
        const nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= this.n || nz >= this.n) continue;
        const d = this.dist[nz * this.n + nx];
        if (d < best) {
          best = d;
          bx = nx;
          bz = nz;
        }
      }
    }
    if (best === Infinity) return out.set(this.target.x - pos.x, 0, this.target.z - pos.z).normalize();
    const c = this.centre(bx, bz);
    return out.set(c.x - pos.x, 0, c.z - pos.z).normalize();
  }

  /** Can an agent at `pos` walk to the current target at all? */
  reachable(pos: THREE.Vector3): boolean {
    return this.dist[this.index(pos.x, pos.z)] < Infinity;
  }

  /** Can an agent walk in a straight line from a to b without touching an obstacle? */
  clearPath(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    return this.obstacles.every((o) => {
      // Closest point on the segment to the obstacle centre.
      const t = THREE.MathUtils.clamp(((o.x - a.x) * abx + (o.z - a.z) * abz) / len2, 0, 1);
      return Math.hypot(a.x + abx * t - o.x, a.z + abz * t - o.z) >= o.radius + PATHING.agentRadius;
    });
  }

  /** Dijkstra from the target cell over 8 neighbours (no cutting blocked corners). */
  private build(start: number): void {
    const { n, dist, blocked } = this;
    dist.fill(Infinity);
    dist[start] = 0;
    const heap = new MinHeap();
    heap.push(start, 0);
    while (heap.size) {
      const [cur, d] = heap.pop();
      if (d > dist[cur]) continue;
      const cx = cur % n;
      const cz = (cur - cx) / n;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const ni = nz * n + nx;
          if (blocked[ni]) continue;
          if (dx && dz && (blocked[cz * n + nx] || blocked[nz * n + cx])) continue;
          const nd = d + (dx && dz ? Math.SQRT2 : 1);
          if (nd < dist[ni]) {
            dist[ni] = nd;
            heap.push(ni, nd);
          }
        }
      }
    }
  }

  private coord(v: number): number {
    return THREE.MathUtils.clamp(Math.floor((v + WORLD_HALF) / PATHING.cell), 0, this.n - 1);
  }

  private index(x: number, z: number): number {
    return this.coord(z) * this.n + this.coord(x);
  }

  private centre(ix: number, iz: number): { x: number; z: number } {
    return { x: (ix + 0.5) * PATHING.cell - WORLD_HALF, z: (iz + 0.5) * PATHING.cell - WORLD_HALF };
  }
}

/** Binary min-heap of (item, priority). */
class MinHeap {
  private items: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, prio: number): void {
    const { items, prios } = this;
    let i = items.length;
    items.push(item);
    prios.push(prio);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prios[p] <= prios[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number] {
    const { items, prios } = this;
    const top: [number, number] = [items[0], prios[0]];
    const lastItem = items.pop()!;
    const lastPrio = prios.pop()!;
    if (items.length) {
      items[0] = lastItem;
      prios[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && prios[l] < prios[m]) m = l;
        if (r < items.length && prios[r] < prios[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prios[a], this.prios[b]] = [this.prios[b], this.prios[a]];
  }
}
