import * as THREE from 'three';
import { diamondBlade } from './geometry';

/** Sword dimensions. Lengths run along the sword's axis (+Y = toward the tip). */
export const SWORD = {
  handle: {
    length: 0.18,
    /** Across the hexagon's corners. */
    width: 0.06,
  },
  guard: {
    /** Side to side, across the blade. */
    width: 0.26,
    /** Along the sword's axis. */
    height: 0.04,
    /** Front to back. */
    depth: 0.06,
  },
  blade: {
    /** Straight, full-width section from the guard. 0 = all taper (stiletto). */
    length: 0.5,
    /** Taper from full width down to the point. */
    tipLength: 0.2,
    /** Edge to edge. */
    width: 0.12,
    /** Ridge to ridge. */
    thickness: 0.03,
  },
};

/** Distance from the grip centre (origin) to the far end of the pommel and to the tip. */
export function swordReach(size = 1): { pommel: number; tip: number } {
  const { handle, guard, blade } = SWORD;
  return {
    pommel: (handle.length / 2) * size,
    tip: (handle.length / 2 + guard.height + blade.length + blade.tipLength) * size,
  };
}

/**
 * Build a sword, `size` times the SWORD dimensions. The origin is the centre
 * of the grip (where a hand holds it) and the blade points up +Y, with its
 * flat sides facing ±Z.
 */
export function makeSword(size = 1, color = 0x9a9ea6): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, flatShading: true });
  const sword = new THREE.Group();
  // Scale the dimensions rather than the group, so the sword's transform
  // stays free for placement and edge thresholds see real geometry.
  const handle = scaled(SWORD.handle, size);
  const guard = scaled(SWORD.guard, size);
  const blade = scaled(SWORD.blade, size);

  const handleMesh = new THREE.Mesh(new THREE.CylinderGeometry(handle.width / 2, handle.width / 2, handle.length, 6), mat);
  sword.add(handleMesh);

  const guardMesh = new THREE.Mesh(new THREE.BoxGeometry(guard.width, guard.height, guard.depth), mat);
  guardMesh.position.y = handle.length / 2 + guard.height / 2;
  sword.add(guardMesh);

  const bladeMesh = new THREE.Mesh(diamondBlade(blade.length, blade.tipLength, blade.width, blade.thickness), mat);
  bladeMesh.position.y = handle.length / 2 + guard.height;
  sword.add(bladeMesh);

  for (const m of [handleMesh, guardMesh, bladeMesh]) m.castShadow = true;
  return sword;
}

function scaled<T extends Record<string, number>>(dims: T, size: number): T {
  return Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v * size])) as T;
}
