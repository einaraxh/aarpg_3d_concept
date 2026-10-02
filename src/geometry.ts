import * as THREE from 'three';

export interface RidgedPrismOptions {
  radiusTop: number;
  radiusBottom: number;
  height: number;
  /** How far the top ridge sits above the top cap (negative = sunk in). */
  topRise: number;
  /** How far the bottom ridge sits below the bottom cap (negative = sunk in). */
  bottomDrop: number;
  /**
   * Ridge length as a fraction of the cap's front-to-back depth.
   * 1 = gable (ridge spans the full depth, front/back faces become pentagons),
   * <1 = hip roof (front/back get their own sloped triangles).
   */
  ridgeLength?: number;
}

/**
 * Hexagonal prism whose caps are "roofs": a ridge line runs front-to-back
 * (along Z) above the top cap and below the bottom cap, and the three corners
 * on each side (left / right) slope up to it.
 *
 * Corners sit at ±X (shoulder points) with flat faces at front/back:
 *
 *        2 ─── 1          +Z (front)
 *       /       \
 *      3    R    0  → +X     R = ridge, running along Z
 *       \       /
 *        4 ─── 5
 */
export function ridgedHexPrism(o: RidgedPrismOptions): THREE.BufferGeometry {
  const ridgeLength = o.ridgeLength ?? 1;
  const h = o.height / 2;

  const ring = (r: number, y: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    });

  const T = ring(o.radiusTop, h);
  const B = ring(o.radiusBottom, -h);
  // Depth of the flat front/back edge from centre is r·cos30°.
  const ridge = (r: number, y: number) => {
    const z = r * Math.cos(Math.PI / 6) * ridgeLength;
    return [new THREE.Vector3(0, y, z), new THREE.Vector3(0, y, -z)];
  };
  const [Tf, Tb] = ridge(o.radiusTop, h + o.topRise);
  const [Bf, Bb] = ridge(o.radiusBottom, -h - o.bottomDrop);

  const tris: THREE.Vector3[][] = [];

  // Sides: one quad per hexagon edge.
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    tris.push([T[i], T[j], B[j]], [T[i], B[j], B[i]]);
  }

  // A roof over one cap: C = cap corners, F/K = front/back ridge ends.
  const roof = (C: THREE.Vector3[], F: THREE.Vector3, K: THREE.Vector3) => {
    tris.push(
      [C[1], C[2], F], // front
      [C[4], C[5], K], // back
      [C[0], C[1], F], [C[0], F, K], [C[5], C[0], K], // right slope
      [C[2], C[3], F], [C[3], K, F], [C[3], C[4], K], // left slope
    );
  };
  roof(T, Tf, Tb);
  roof(B, Bf, Bb);

  return convexMesh(tris, new THREE.Vector3());
}

/**
 * Tetrahedron shaped as a foot: flat triangular sole on y = 0 with the toe
 * pointing forward (+Z), and the peak set back over the heel.
 */
export function footTetrahedron(length: number, width: number, height: number): THREE.BufferGeometry {
  const toe = new THREE.Vector3(0, 0, length * 0.65);
  const heelL = new THREE.Vector3(width / 2, 0, -length * 0.35);
  const heelR = new THREE.Vector3(-width / 2, 0, -length * 0.35);
  const peak = new THREE.Vector3(0, height, -length * 0.15);
  const tris = [
    [toe, heelL, heelR],
    [toe, heelL, peak],
    [heelL, heelR, peak],
    [heelR, toe, peak],
  ];
  const inside = toe.clone().add(heelL).add(heelR).add(peak).divideScalar(4);
  return convexMesh(tris, inside);
}

/**
 * Sword blade: a diamond-section prism (a box squished along its diagonal)
 * with the four top corners joined to a single tip. The tip is the same as
 * two tetrahedrons joined flat-face to flat-face. Base sits on y = 0, tip
 * points up +Y, edges at ±X and centre ridges at ±Z.
 *
 *   front view      cross-section
 *       ▲  tip           ◆  ← thickness (Z)
 *      / \             ◀───▶ width (X)
 *     |   |
 *     |   |  straight
 *     |___|
 */
export function diamondBlade(straight: number, tip: number, width: number, thickness: number): THREE.BufferGeometry {
  const diamond = (y: number) => [
    new THREE.Vector3(width / 2, y, 0),
    new THREE.Vector3(0, y, thickness / 2),
    new THREE.Vector3(-width / 2, y, 0),
    new THREE.Vector3(0, y, -thickness / 2),
  ];
  const B = diamond(0);
  const T = diamond(straight);
  const point = new THREE.Vector3(0, straight + tip, 0);

  const tris: THREE.Vector3[][] = [
    [B[0], B[1], B[2]], [B[0], B[2], B[3]], // base
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (straight > 0) tris.push([B[i], B[j], T[j]], [B[i], T[j], T[i]]); // flat of the blade
    tris.push([T[i], T[j], point]); // tip
  }
  return convexMesh(tris, new THREE.Vector3(0, (straight + tip) / 4, 0));
}

/**
 * Build a flat-shaded geometry from triangles of a convex shape, orienting
 * each to face away from `inside` rather than hand-tracking winding order.
 */
function convexMesh(tris: THREE.Vector3[][], inside: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue; // skip degenerate
    out.copy(a).add(b).add(c).divideScalar(3).sub(inside);
    const [p, q, r] = n.dot(out) >= 0 ? [a, b, c] : [a, c, b];
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
