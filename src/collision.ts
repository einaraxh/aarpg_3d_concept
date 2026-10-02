import * as THREE from 'three';
import { WORLD_HALF, type Obstacle } from './world';

/**
 * Everything collides as circles on the ground plane (x, z). Static
 * obstacles never move; agents (player, enemies) push out of them and
 * shove each other apart.
 */

/** A moving circle. `mass` decides who gives way when two agents overlap. */
export interface Agent {
  pos: THREE.Vector3;
  radius: number;
  mass: number;
}

/** Push a circle out of every overlapping obstacle and keep it inside the world. */
export function resolveStatic(pos: THREE.Vector3, radius: number, obstacles: readonly Obstacle[]): void {
  for (const o of obstacles) {
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const min = o.radius + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = o.x + (dx / d) * min;
      pos.z = o.z + (dz / d) * min;
    }
  }
  const lim = WORLD_HALF - 1;
  pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
  pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);
}

/** Separate overlapping agents, splitting the push by mass (heavier moves less). */
export function separateAgents(agents: readonly Agent[]): void {
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      let dx = b.pos.x - a.pos.x;
      let dz = b.pos.z - a.pos.z;
      const min = a.radius + b.radius;
      let d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      if (d2 < 1e-8) {
        // Exactly on top of each other: pick any direction.
        dx = 1;
        dz = 0;
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      const push = min - d;
      const shareA = b.mass / (a.mass + b.mass);
      a.pos.x -= (dx / d) * push * shareA;
      a.pos.z -= (dz / d) * push * shareA;
      b.pos.x += (dx / d) * push * (1 - shareA);
      b.pos.z += (dz / d) * push * (1 - shareA);
    }
  }
}

/** Is a circle of `radius` at (x, z) free of obstacles? */
export function isFree(x: number, z: number, radius: number, obstacles: readonly Obstacle[]): boolean {
  return obstacles.every((o) => Math.hypot(x - o.x, z - o.z) >= o.radius + radius);
}
