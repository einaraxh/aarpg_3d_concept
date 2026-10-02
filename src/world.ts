import * as THREE from 'three';

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

export const WORLD_HALF = 30;

export function buildWorld(scene: THREE.Scene): { ground: THREE.Mesh; obstacles: Obstacle[] } {
  scene.background = new THREE.Color(0x1a1d24);
  scene.fog = new THREE.Fog(0x1a1d24, 28, 60);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a2f25, 0.9));

  const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
  sun.position.set(8, 16, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(WORLD_HALF * 2, WORLD_HALF, 0x000000, 0x000000);
  (grid.material as THREE.Material).opacity = 0.12;
  (grid.material as THREE.Material).transparent = true;
  grid.position.y = 0.01;
  scene.add(grid);

  // Scatter pillars and rocks with a fixed seed so the layout is stable.
  const obstacles: Obstacle[] = [];
  const rand = mulberry32(7);
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.9 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x6b6358, roughness: 1, flatShading: true });

  for (let i = 0; i < 40; i++) {
    const x = (rand() * 2 - 1) * (WORLD_HALF - 3);
    const z = (rand() * 2 - 1) * (WORLD_HALF - 3);
    if (Math.hypot(x, z) < 9) continue; // keep spawn + showcase ring clear

    let mesh: THREE.Mesh;
    let radius: number;
    if (rand() < 0.5) {
      const h = 1.5 + rand() * 2.5;
      radius = 0.4 + rand() * 0.3;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.15, h, 10), stone);
      mesh.position.set(x, h / 2, z);
    } else {
      radius = 0.5 + rand() * 0.8;
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), rock);
      mesh.position.set(x, radius * 0.5, z);
      mesh.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      radius *= 0.85;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    obstacles.push({ x, z, radius });
  }

  return { ground, obstacles };
}

/** Make the shadow camera follow a point so shadows stay crisp near the player. */
export function followShadow(scene: THREE.Scene, target: THREE.Vector3): void {
  const sun = scene.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight);
  if (!sun) return;
  sun.position.set(target.x + 8, 16, target.z + 6);
  sun.target.position.copy(target);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
