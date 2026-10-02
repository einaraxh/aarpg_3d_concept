import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Character } from './character';
import type { Agent } from './collision';

/** Combat tuning. Damage per hit, distances in world units, angles in degrees. */
export const COMBAT = {
  player: {
    hp: 100,
    radius: 0.35,
    /** Heavier than a zombie, so zombies get shoved aside more than the player does. */
    mass: 3,
    /** Damage and reach without a weapon. Weapons use ITEMS (loadout.ts). */
    unarmed: { damage: 8, reach: 0.9 },
    /** Width of the swing's hit cone, centred on the facing. */
    arc: 140,
    /** Speed given to whatever the player hits. */
    knockback: 4,
    /** Seconds before respawning after death. */
    respawnDelay: 3,
  },
  /** How far the hand sits in front of the body at the strike; weapon length is added on top. */
  handReach: 0.45,
  /** Seconds a hit character glows. */
  flash: 0.12,
};

export class Health {
  hp: number;
  constructor(readonly max: number) {
    this.hp = max;
  }
  get dead(): boolean {
    return this.hp <= 0;
  }
  get fraction(): number {
    return Math.max(0, this.hp / this.max);
  }
  /** Returns the damage actually taken (never below 0 hp). */
  damage(amount: number): number {
    const taken = Math.min(this.hp, amount);
    this.hp -= taken;
    return taken;
  }
  reset(): void {
    this.hp = this.max;
  }
}

/** Anything that fights: a character with health, a collision circle and a velocity. */
export class Fighter implements Agent {
  readonly health: Health;
  /** Ground velocity; knockback is added here and decays as movement takes over. */
  readonly velocity = new THREE.Vector3();
  private flashTime = 0;

  constructor(
    readonly character: Character,
    maxHp: number,
    readonly radius: number,
    readonly mass: number,
  ) {
    this.health = new Health(maxHp);
  }

  get pos(): THREE.Vector3 {
    return this.character.root.position;
  }

  get yaw(): number {
    return this.character.root.rotation.y;
  }

  get dead(): boolean {
    return this.health.dead;
  }

  /** Take damage from a hit that came from `from`. Returns the damage taken. */
  takeHit(amount: number, from: THREE.Vector3, knockback: number): number {
    if (this.dead) return 0;
    const taken = this.health.damage(amount);
    this.flashTime = COMBAT.flash;
    const away = this.pos.clone().sub(from).setY(0);
    if (away.lengthSq() > 1e-6) this.velocity.addScaledVector(away.normalize(), knockback);
    return taken;
  }

  /** Hit-flash fade. Call once per frame. */
  updateFx(dt: number): void {
    this.flashTime = Math.max(0, this.flashTime - dt);
    const k = this.flashTime / COMBAT.flash;
    this.character.mat.emissive.setRGB(k * 0.9, k * 0.15, k * 0.1);
  }
}

/**
 * Does a swing from `attacker` reach `target`? In range (centre to centre,
 * minus the target's radius) and within the cone in front of the attacker.
 */
export function inSwing(attacker: Fighter, target: Fighter, reach: number, arcDeg: number): boolean {
  const dx = target.pos.x - attacker.pos.x;
  const dz = target.pos.z - attacker.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > reach + target.radius) return false;
  if (dist < attacker.radius + target.radius) return true; // touching: always hits
  const off = Math.atan2(dx, dz) - attacker.yaw;
  return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= THREE.MathUtils.degToRad(arcDeg / 2);
}

// ─── Floating damage numbers ─────────────────────────────────────────────

interface Floater {
  obj: CSS2DObject;
  age: number;
}
const floaters: Floater[] = [];
const FLOAT_LIFE = 0.8;

/** Pop a number above `pos` that rises and fades. */
export function showDamage(scene: THREE.Scene, pos: THREE.Vector3, amount: number, color: string): void {
  const div = document.createElement('div');
  div.className = 'damage';
  div.textContent = String(Math.round(amount));
  div.style.color = color;
  const obj = new CSS2DObject(div);
  obj.position.set(pos.x + (Math.random() - 0.5) * 0.4, 1.6, pos.z);
  scene.add(obj);
  floaters.push({ obj, age: 0 });
}

export function updateDamageText(dt: number): void {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.age += dt;
    f.obj.position.y += dt * 1.2;
    f.obj.element.style.opacity = String(1 - f.age / FLOAT_LIFE);
    if (f.age >= FLOAT_LIFE) {
      f.obj.removeFromParent();
      f.obj.element.remove();
      floaters.splice(i, 1);
    }
  }
}

// ─── Death: the floating parts lose their hold and fall apart ────────────

interface Piece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}
interface Wreck {
  pieces: Piece[];
  mat: THREE.MeshStandardMaterial;
  age: number;
  disposeGeometry: boolean;
}
const wrecks: Wreck[] = [];
const WRECK = { life: 2.5, fade: 0.8, gravity: 14 };

/**
 * Copy every mesh of `character` into the scene as loose pieces that burst
 * away from `from` and tumble to the ground, then hide the character.
 * `disposeGeometry` frees the shared geometry once the pieces are gone (for
 * characters that won't be shown again).
 */
export function shatter(scene: THREE.Scene, character: Character, from: THREE.Vector3, disposeGeometry: boolean): void {
  const mat = character.mat.clone();
  mat.emissive.setRGB(0, 0, 0);
  mat.transparent = true;
  const centre = character.root.position;
  const away = centre.clone().sub(from).setY(0).normalize();
  const pieces: Piece[] = [];
  character.root.updateMatrixWorld(true);
  character.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mesh = new THREE.Mesh(o.geometry, o.material === character.mat ? mat : o.material);
    o.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.castShadow = true;
    scene.add(mesh);
    const out = mesh.position.clone().sub(centre).setY(0);
    const vel = out.multiplyScalar(2).addScaledVector(away, 2.5);
    vel.y = 1.5 + Math.random() * 2;
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
    pieces.push({ mesh, vel, spin });
  });
  character.root.visible = false;
  wrecks.push({ pieces, mat, age: 0, disposeGeometry });
}

export function updateWrecks(dt: number): void {
  for (let i = wrecks.length - 1; i >= 0; i--) {
    const w = wrecks[i];
    w.age += dt;
    for (const p of w.pieces) {
      p.vel.y -= WRECK.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const floor = 0.06;
      if (p.mesh.position.y < floor) {
        // Land: stop falling, bleed off slide and spin.
        p.mesh.position.y = floor;
        p.vel.y = Math.abs(p.vel.y) * 0.25;
        p.vel.x *= 0.8;
        p.vel.z *= 0.8;
        p.spin.multiplyScalar(0.7);
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
    }
    w.mat.opacity = THREE.MathUtils.clamp((WRECK.life - w.age) / WRECK.fade, 0, 1);
    if (w.age >= WRECK.life) {
      const geos = new Set<THREE.BufferGeometry>();
      for (const p of w.pieces) {
        p.mesh.removeFromParent();
        geos.add(p.mesh.geometry);
      }
      if (w.disposeGeometry) geos.forEach((g) => g.dispose());
      w.mat.dispose();
      wrecks.splice(i, 1);
    }
  }
}
