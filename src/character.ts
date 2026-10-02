import * as THREE from 'three';
import {
  blendPose,
  idlePose,
  IDLE,
  JOGS,
  jogPose,
  strideAt,
  swingDuration,
  swingImpactTime,
  swingPose,
  type JogStyle,
  type PartPose,
} from './animation';
import { footTetrahedron, ridgedHexPrism } from './geometry';
import { ITEMS, type Loadout } from './loadout';
import { makeSword, swordReach } from './sword';

/**
 * Floating-parts character with a shallow hierarchy:
 *
 *   root            world position + facing (movement code)
 *   ├─ body         pivot at the waist: bob, lean, twist
 *   │  ├─ torso     mesh (its scale.z squash stays on the mesh only)
 *   │  ├─ handL     anchor → pivot → mesh
 *   │  ├─ handR     anchor → pivot → mesh (+ held item on the pivot)
 *   │  └─ (item on the back)
 *   ├─ head         anchor → pivot → mesh; NOT on the body, it copies the
 *   │               body's bob with a delay (see animation.ts)
 *   ├─ footL        independent of body: stays on the ground
 *   └─ footR
 *
 * Anchors hold each part's rest position; animation moves the pivot inside
 * its anchor, so body motion and per-part motion add up naturally. Shape
 * scaling lives on the mesh only, so anything attached to a pivot (a held
 * sword) follows the part's motion without inheriting its squash.
 */

/** Height of the waist (bottom of the torso's sides) above the ground. */
const WAIST_Y = 0.52;
const TORSO_HEIGHT = 0.40;
const TORSO_TOP_RISE = 0.1;
const TORSO_RADIUS_BOTTOM = 0.20;
/** Empty space between floating parts. */
const GAP = 0.05;

// Oversized head and hands for an arcade-character silhouette.
const HEAD_RADIUS = 0.19;
const HAND_RADIUS = 0.16;
/** Head centre above the waist at rest. */
const HEAD_ABOVE_WAIST = TORSO_HEIGHT + TORSO_TOP_RISE + GAP + HEAD_RADIUS;

const FOOT = {
  /** Toe to heel. */
  length: 0.3,
  /** Across the heel. */
  width: 0.22,
  /** Sole to peak. */
  height: 0.10,
  /** Distance of each foot's centre from the body's centre line. */
  spacing: 0.2,
  /** Outward turn of each toe, in degrees. */
  splay: 15,
};

/** Two-handed sword slung diagonally across the back. */
const BACK_SWORD = {
  /** Tilt from vertical in degrees; positive puts the handle over the left (+X) shoulder. */
  angle: 35,
  /** Height of the sword's midpoint above the waist. */
  height: 0.28,
  /** Distance behind the torso's centre line. */
  back: 0.17,
};

/** How an item sits in the right (−X) hand. Grip centre sits on the hand's centre. */
const HAND_GRIP = {
  /** Blade tilt forward from straight up, in degrees. 90 = pointing straight forward, level. */
  tilt: 90,
};

interface Part {
  anchor: THREE.Group;
  /** Animated; unscaled so attachments don't skew. */
  pivot: THREE.Group;
  mesh: THREE.Mesh;
}

export class Character {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly torso: THREE.Mesh;
  readonly head: Part;
  readonly handL: Part;
  readonly handR: Part;
  readonly footL: THREE.Mesh;
  readonly footR: THREE.Mesh;
  /** Currently equipped item, if any. */
  item: THREE.Group | null = null;

  /** Idle phase in degrees, 0–360; runs on time. */
  idlePhase = 0;
  /** Jog phase in degrees, 0–360; runs on distance travelled. */
  jogPhase = 0;
  /** 0 = idle, 1 = jogging. Eases toward the target set by speed. */
  jogWeight = 0;
  /** Which jog variant to use when moving. */
  jogStyle: JogStyle = 'jog1';
  /** Seconds into the current swing, or null when not swinging. */
  private swingTime: number | null = null;
  /** 0 = locomotion, 1 = swing. Eases in fast so starting a swing doesn't pop. */
  private swingWeight = 0;
  /** Swing playback speed (1 = SWING.duration). Lower = slower, easier to read. */
  swingRate = 1;
  /** True for the one update in which the swing reaches its moment of impact. */
  struck = false;

  /** Shared by all body parts (not the item), e.g. for hit flashes. */
  readonly mat: THREE.MeshStandardMaterial;

  constructor(color = 0x9a9ea6) {
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, flatShading: true });
    this.body.position.y = WAIST_Y;
    this.root.add(this.body);

    // Hexagonal prism tapering toward the waist: broad shoulders, narrow hips.
    // Caps are ridged: shoulders slope up to the neck, hips slope down to a V.
    const torsoGeo = ridgedHexPrism({
      radiusTop: 0.3,
      radiusBottom: TORSO_RADIUS_BOTTOM,
      height: TORSO_HEIGHT,
      topRise: TORSO_TOP_RISE,
      bottomDrop: 0.07,
    });
    this.torso = this.mesh(torsoGeo, this.body);
    this.torso.position.y = TORSO_HEIGHT / 2; // sits on the waist pivot
    // Flatten front-to-back so it reads as a chest, not a barrel.
    this.torso.scale.z = 0.55;

    this.head = this.part(new THREE.IcosahedronGeometry(HEAD_RADIUS), 0, WAIST_Y + HEAD_ABOVE_WAIST, this.root);

    // Flat octahedrons as hands, hanging beside the hips with palms facing in.
    const handGeo = new THREE.OctahedronGeometry(HAND_RADIUS);
    const handX = TORSO_RADIUS_BOTTOM + GAP + 0.16;
    this.handL = this.part(handGeo, handX, 0);
    this.handR = this.part(handGeo, -handX, 0);
    for (const hand of [this.handL, this.handR]) hand.mesh.scale.set(0.4, 1.15, 0.8);

    this.equip({ item: 'sword', slot: 'back' });

    // Tetrahedron feet resting on the ground, toes forward.
    const footGeo = footTetrahedron(FOOT.length, FOOT.width, FOOT.height);
    this.footL = this.mesh(footGeo, this.root);
    this.footR = this.mesh(footGeo, this.root);
    const splay = THREE.MathUtils.degToRad(FOOT.splay);
    for (const [foot, side] of [[this.footL, 1], [this.footR, -1]] as const) {
      foot.position.x = side * FOOT.spacing;
      foot.rotation.y = side * splay; // turn toe away from the centre line
    }
  }

  /** Start a melee swing (ignored if one is already playing). */
  swing(): void {
    if (this.swingTime === null) this.swingTime = 0;
  }

  get isSwinging(): boolean {
    return this.swingTime !== null;
  }

  /**
   * @param speed ground speed in units/s. Drives the jog phase (so planted
   *              feet don't slide) and the idle ↔ jog blend.
   */
  update(dt: number, speed = 0): void {
    this.idlePhase = (this.idlePhase + (dt / IDLE.cycleSeconds) * 360) % 360;
    const jog = JOGS[this.jogStyle];
    const stride = strideAt(speed, jog);
    this.jogPhase = (this.jogPhase + (speed / stride) * 360 * dt) % 360;

    const target = Math.min(1, speed / jog.blend.fullAt);
    this.jogWeight = THREE.MathUtils.damp(this.jogWeight, target, jog.blend.rate, dt);

    // The swing replaces locomotion while it plays (no attacking on the move).
    this.struck = false;
    if (this.swingTime !== null) {
      const before = this.swingTime;
      this.swingTime += dt * this.swingRate;
      const impact = swingImpactTime();
      this.struck = before < impact && this.swingTime >= impact;
      if (this.swingTime >= swingDuration()) this.swingTime = null;
    }
    this.swingWeight = THREE.MathUtils.damp(this.swingWeight, this.swingTime !== null ? 1 : 0, 30, dt);

    this.applyCurrentPose(stride);
  }

  /**
   * Show one animation at a point on its 0–1 cycle, without advancing time
   * (for scrubbing in the inspector). Jogs use their treadmill speed's stride.
   */
  preview(anim: 'idle' | 'jog' | 'swing', u: number): void {
    u = THREE.MathUtils.clamp(u, 0, 1);
    this.jogWeight = anim === 'jog' ? 1 : 0;
    this.swingWeight = anim === 'swing' ? 1 : 0;
    this.swingTime = anim === 'swing' ? Math.min(u, 0.9999) * swingDuration() : null;
    if (anim === 'idle') this.idlePhase = u * 360;
    if (anim === 'jog') this.jogPhase = u * 360;
    const jog = JOGS[this.jogStyle];
    this.applyCurrentPose(strideAt(jog.speed, jog));
  }

  /** Where `anim` currently is on its 0–1 cycle (swing: 0 when not playing). */
  progress(anim: 'idle' | 'jog' | 'swing'): number {
    if (anim === 'idle') return this.idlePhase / 360;
    if (anim === 'jog') return this.jogPhase / 360;
    return this.swingTime === null ? 0 : this.swingTime / swingDuration();
  }

  private applyCurrentPose(stride: number): void {
    const jog = JOGS[this.jogStyle];
    let pose = blendPose(idlePose(this.idlePhase), jogPose(this.jogPhase, stride, jog, HEAD_ABOVE_WAIST), this.jogWeight);
    if (this.swingWeight > 1e-3) {
      const u = this.swingTime === null ? 1 : this.swingTime / swingDuration();
      pose = blendPose(pose, swingPose(u, HEAD_ABOVE_WAIST), this.swingWeight);
    }

    const b = pose.body;
    this.body.position.set(b.x, WAIST_Y + b.y, b.z);
    this.body.rotation.set(b.rx, b.ry, b.rz, 'YXZ'); // twist, then lean in the twisted frame
    applyPose(this.head.pivot, pose.head, 'YXZ'); // same order as the body
    applyPose(this.handL.pivot, pose.handL);
    applyPose(this.handR.pivot, pose.handR);

    const splay = THREE.MathUtils.degToRad(FOOT.splay);
    for (const [foot, fp, side] of [[this.footL, pose.footL, 1], [this.footR, pose.footR, -1]] as const) {
      foot.position.set(side * FOOT.spacing + fp.x, fp.y, fp.z);
      // Yaw (splay) first, then pitch about the foot's own axis.
      foot.rotation.set(fp.rx, side * splay + fp.ry, fp.rz, 'YXZ');
    }
  }

  /** Swap the equipped item and where it sits. */
  equip({ item, slot }: Loadout): void {
    if (this.item) {
      this.item.removeFromParent();
      this.item.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      this.item = null;
    }
    if (item === 'none') return;

    const size = ITEMS[item].size;
    const sword = makeSword(size);
    if (slot === 'back') {
      // Riding with the body; flat of the blade (±Z) against the back,
      // handle up over the shoulder, tip down.
      sword.rotation.z = Math.PI - THREE.MathUtils.degToRad(BACK_SWORD.angle);
      // Place the grip so the sword's midpoint sits at the configured spot.
      const reach = swordReach(size);
      const tipDir = new THREE.Vector3(0, 1, 0).applyEuler(sword.rotation);
      sword.position.set(0, BACK_SWORD.height, -BACK_SWORD.back).addScaledVector(tipDir, -(reach.tip - reach.pommel) / 2);
      this.body.add(sword);
    } else {
      // Edge facing forward (flat sides ±X), blade tilted forward from upright.
      sword.rotation.set(THREE.MathUtils.degToRad(HAND_GRIP.tilt), Math.PI / 2, 0, 'XYZ');
      this.handR.pivot.add(sword);
    }
    this.item = sword;
  }

  /** A part: anchor at its rest position → animated pivot → mesh. Body-mounted by default. */
  private part(geo: THREE.BufferGeometry, x: number, y: number, parent: THREE.Object3D = this.body): Part {
    const anchor = new THREE.Group();
    anchor.position.set(x, y, 0);
    const pivot = new THREE.Group();
    anchor.add(pivot);
    parent.add(anchor);
    return { anchor, pivot, mesh: this.mesh(geo, pivot) };
  }

  private mesh(geo: THREE.BufferGeometry, parent: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
}

function applyPose(o: THREE.Object3D, p: PartPose, order: THREE.EulerOrder = 'XYZ'): void {
  o.position.set(p.x, p.y, p.z);
  o.rotation.set(p.rx, p.ry, p.rz, order);
}

