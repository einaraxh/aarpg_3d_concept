import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Obstacle } from './world';

interface Entry {
  name: string;
  geo: THREE.BufferGeometry;
  flat?: boolean;
}

/** Every built-in three.js geometry, plus a few low-poly/stylised variants. */
function entries(): Entry[] {
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.2 : 0.45;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }

  const vase = [0.05, 0.3, 0.38, 0.3, 0.18, 0.15, 0.25].map((r, i) => new THREE.Vector2(r, i * 0.14 - 0.42));

  const curve = new THREE.CatmullRomCurve3(
    [
      [-0.4, -0.3, 0],
      [-0.1, 0.3, 0.2],
      [0.2, -0.2, -0.2],
      [0.4, 0.3, 0],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  );

  return [
    { name: 'Box', geo: new THREE.BoxGeometry(0.7, 0.7, 0.7) },
    { name: 'Sphere', geo: new THREE.SphereGeometry(0.42, 32, 16) },
    { name: 'Sphere (low-poly)', geo: new THREE.SphereGeometry(0.42, 7, 5), flat: true },
    { name: 'Capsule', geo: new THREE.CapsuleGeometry(0.25, 0.45, 6, 16) },
    { name: 'Cylinder', geo: new THREE.CylinderGeometry(0.32, 0.32, 0.8, 24) },
    { name: 'Cone', geo: new THREE.ConeGeometry(0.38, 0.85, 24) },
    { name: 'Cylinder (6-sided)', geo: new THREE.CylinderGeometry(0.3, 0.4, 0.8, 6), flat: true },
    { name: 'Torus', geo: new THREE.TorusGeometry(0.32, 0.12, 16, 40) },
    { name: 'Torus Knot', geo: new THREE.TorusKnotGeometry(0.26, 0.09, 96, 12) },
    { name: 'Tetrahedron', geo: new THREE.TetrahedronGeometry(0.5), flat: true },
    { name: 'Octahedron', geo: new THREE.OctahedronGeometry(0.48), flat: true },
    { name: 'Dodecahedron', geo: new THREE.DodecahedronGeometry(0.45), flat: true },
    { name: 'Icosahedron', geo: new THREE.IcosahedronGeometry(0.45), flat: true },
    { name: 'Icosahedron (detail 1)', geo: new THREE.IcosahedronGeometry(0.45, 1), flat: true },
    { name: 'Lathe (spun profile)', geo: new THREE.LatheGeometry(vase, 20) },
    { name: 'Extrude (2D shape)', geo: new THREE.ExtrudeGeometry(star, { depth: 0.2, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }) },
    { name: 'Tube (along curve)', geo: new THREE.TubeGeometry(curve, 48, 0.08, 10) },
    { name: 'Plane', geo: new THREE.PlaneGeometry(0.75, 0.75) },
    { name: 'Circle', geo: new THREE.CircleGeometry(0.4, 32) },
    { name: 'Ring', geo: new THREE.RingGeometry(0.2, 0.42, 32) },
  ];
}

const RADIUS = 6.5;

/** Spawns a labelled ring of primitives around the origin. Returns a per-frame update. */
export function spawnShowcase(scene: THREE.Scene, obstacles: Obstacle[]): (t: number) => void {
  const list = entries();
  const items: { mesh: THREE.Mesh; seed: number }[] = [];

  list.forEach((e, i) => {
    const hue = i / list.length;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.55, 0.6),
      roughness: 0.55,
      flatShading: e.flat ?? false,
      side: THREE.DoubleSide, // flat shapes (plane/circle/ring) need both sides
    });
    e.geo.center();
    const mesh = new THREE.Mesh(e.geo, mat);
    mesh.castShadow = true;

    const a = (i / list.length) * Math.PI * 2;
    const x = Math.cos(a) * RADIUS;
    const z = Math.sin(a) * RADIUS;
    mesh.position.set(x, 1.2, z);
    scene.add(mesh);

    const div = document.createElement('div');
    div.className = 'label';
    div.textContent = e.name;
    const label = new CSS2DObject(div);
    label.position.set(x, 0.25, z);
    scene.add(label);

    obstacles.push({ x, z, radius: 0.45 });
    items.push({ mesh, seed: i * 1.7 });
  });

  return (t) => {
    for (const { mesh, seed } of items) {
      mesh.position.y = 1.2 + Math.sin(t * 1.6 + seed) * 0.12;
      mesh.rotation.set(Math.sin(t * 0.5 + seed) * 0.4, t * 0.6 + seed, 0);
    }
  };
}
