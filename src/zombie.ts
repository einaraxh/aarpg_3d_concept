import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { JOGS } from './animation';
import { Character } from './character';
import { isFree } from './collision';
import { Fighter, inSwing, shatter } from './combat';
import type { FlowField } from './pathing';
import type { Obstacle } from './world';
import { WORLD_HALF } from './world';

/** Zombie tuning. */
export const ZOMBIE = {
  color: 0x7f9a74,
  hp: 60,
  radius: 0.35,
  mass: 1,
  /** Walking speed; the shamble animation is tuned for JOGS.shamble.speed. */
  speed: JOGS.shamble.speed,
  /** How quickly it reaches walking speed (and how fast knockback wears off). */
  accel: 6,
  /** Turn rate while walking; slow, so it's easy to sidestep. */
  turnRate: 4,
  attack: {
    /** Starts a swing when the player is this close (centre to centre). */
    range: 1.15,
    /** Hit distance at the moment of impact (plus the player's radius). */
    reach: 0.95,
    /** Hit cone width, degrees. */
    arc: 100,
    damage: 10,
    knockback: 2.5,
    /** Swing playback speed: under 1 = slower than the player's, a readable telegraph. */
    swingRate: 0.55,
    /** Seconds between swings. */
    cooldown: 1.0,
  },
  spawn: {
    /** Zombies alive at once. */
    count: 3,
    /** Distance from the player at which they appear. */
    minDistance: 10,
    maxDistance: 15,
    /** Seconds before a killed zombie is replaced. */
    respawnDelay: 2,
    /** Seconds spent rising out of the ground. */
    rise: 0.9,
  },
};

export class Zombie extends Fighter {
  private cooldown = 0;
  private riseTime = 0;
  private hpBar: CSS2DObject;
  private hpFill: HTMLDivElement;
  private dir = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    position: THREE.Vector3,
  ) {
    super(new Character(ZOMBIE.color), ZOMBIE.hp, ZOMBIE.radius, ZOMBIE.mass);
    const c = this.character;
    c.equip({ item: 'none', slot: 'back' });
    c.jogStyle = 'shamble';
    c.swingRate = ZOMBIE.attack.swingRate;
    c.root.position.copy(position);
    c.root.rotation.y = Math.random() * Math.PI * 2;
    scene.add(c.root);

    const bar = document.createElement('div');
    bar.className = 'hpbar';
    this.hpFill = document.createElement('div');
    bar.append(this.hpFill);
    this.hpBar = new CSS2DObject(bar);
    this.hpBar.position.y = 1.75;
    c.root.add(this.hpBar);
    this.updateBar();
  }

  /** Still climbing out of the ground: can't act or be hit yet. */
  get rising(): boolean {
    return this.riseTime < ZOMBIE.spawn.rise;
  }

  update(dt: number, player: Fighter, flow: FlowField, onHitPlayer: (damage: number) => void): void {
    const c = this.character;
    this.updateFx(dt);
    this.updateBar();

    if (this.rising) {
      this.riseTime += dt;
      const k = Math.min(1, this.riseTime / ZOMBIE.spawn.rise);
      c.root.position.y = -1.6 * (1 - k) ** 2;
      c.update(dt, 0);
      return;
    }
    c.root.position.y = 0;
    this.cooldown = Math.max(0, this.cooldown - dt);

    const toPlayer = player.pos.clone().sub(this.pos).setY(0);
    const dist = toPlayer.length();
    const desired = new THREE.Vector3();
    let face: number | null = null;

    if (c.isSwinging) {
      // Committed: no moving or turning until the swing is over.
      if (c.struck && !player.dead && inSwing(this, player, ZOMBIE.attack.reach, ZOMBIE.attack.arc)) {
        onHitPlayer(ZOMBIE.attack.damage);
      }
    } else if (!player.dead && dist <= ZOMBIE.attack.range) {
      // In range: square up and swing when ready.
      face = Math.atan2(toPlayer.x, toPlayer.z);
      if (this.cooldown <= 0 && Math.abs(angleDelta(this.yaw, face)) < 0.5) {
        c.swing();
        this.cooldown = ZOMBIE.attack.cooldown;
        this.velocity.set(0, 0, 0);
      }
    } else if (!player.dead) {
      flow.direction(this.pos, this.dir);
      desired.copy(this.dir).multiplyScalar(ZOMBIE.speed);
    }

    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, desired.x, ZOMBIE.accel, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, desired.z, ZOMBIE.accel, dt);
    this.pos.addScaledVector(this.velocity, dt);

    // Face where it's walking (not where knockback pushes it), or the player.
    if (face === null && desired.lengthSq() > 0) face = Math.atan2(desired.x, desired.z);
    if (face !== null && !c.isSwinging) {
      c.root.rotation.y += angleDelta(c.root.rotation.y, face) * (1 - Math.exp(-ZOMBIE.turnRate * dt));
    }

    // Animate at walking speed only: knockback slides it without stepping.
    const along = Math.max(0, this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw));
    c.update(dt, along);
  }

  /** Fall apart and clean up. */
  die(from: THREE.Vector3): void {
    this.hpBar.element.remove();
    this.hpBar.removeFromParent();
    shatter(this.scene, this.character, from, true);
    this.character.root.removeFromParent();
    this.character.mat.dispose();
  }

  private updateBar(): void {
    this.hpFill.style.width = `${this.health.fraction * 100}%`;
    // Only show once hurt, to keep the screen clean.
    this.hpBar.element.style.visibility = this.health.fraction < 1 ? 'visible' : 'hidden';
  }
}

/** Keeps `ZOMBIE.spawn.count` zombies alive, spawning replacements away from the player. */
export class ZombieSpawner {
  readonly zombies: Zombie[] = [];
  /** Countdown per missing zombie. */
  private pending: number[] = [];
  kills = 0;

  constructor(
    private scene: THREE.Scene,
    private obstacles: readonly Obstacle[],
    private flow: FlowField,
  ) {
    for (let i = 0; i < ZOMBIE.spawn.count; i++) this.pending.push(0);
  }

  update(dt: number, player: Fighter): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i] -= dt;
      if (this.pending[i] > 0) continue;
      const at = this.findSpot(player.pos);
      if (!at) continue; // try again next frame
      this.zombies.push(new Zombie(this.scene, at));
      this.pending.splice(i, 1);
    }
  }

  /** Remove a dead zombie and queue its replacement. */
  kill(z: Zombie, from: THREE.Vector3): void {
    z.die(from);
    this.zombies.splice(this.zombies.indexOf(z), 1);
    this.pending.push(ZOMBIE.spawn.respawnDelay);
    this.kills++;
  }

  /** Clear everything and start over (e.g. after the player dies). */
  reset(): void {
    for (const z of [...this.zombies]) z.die(z.pos);
    this.zombies.length = 0;
    this.pending = Array.from({ length: ZOMBIE.spawn.count }, () => ZOMBIE.spawn.respawnDelay);
    this.kills = 0;
  }

  /** A random free, reachable spot in the spawn ring around `centre`. */
  private findSpot(centre: THREE.Vector3): THREE.Vector3 | null {
    const { minDistance, maxDistance } = ZOMBIE.spawn;
    const lim = WORLD_HALF - 2;
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = minDistance + Math.random() * (maxDistance - minDistance);
      const p = new THREE.Vector3(centre.x + Math.sin(a) * r, 0, centre.z + Math.cos(a) * r);
      if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) continue;
      if (!isFree(p.x, p.z, ZOMBIE.radius + 0.2, this.obstacles)) continue;
      if (!this.flow.reachable(p)) continue;
      if (this.zombies.some((z) => z.pos.distanceTo(p) < 1.5)) continue;
      return p;
    }
    return null;
  }
}

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
