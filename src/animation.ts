import * as THREE from 'three';

/**
 * Pose functions: phase (degrees) in → a transform offset for every part out.
 * The character blends poses (idle ↔ jog) and applies them; no state here.
 *
 * All angles in configs are degrees. One cycle = 360°.
 */

/** Idle tuning. Phase runs on time. */
export const IDLE = {
  /** Seconds for one full cycle (0° → 360°). */
  cycleSeconds: 2.4,
  bob: {
    /** Peak distance the body moves up (and down) from rest. */
    height: 0.025,
    /** Where in the cycle the bob starts. */
    phaseOffset: 0,
  },
  head: {
    /** Extra bob on top of the body's (the head copies the body bob, plus this). */
    height: 0.012,
    /** Degrees the head trails behind the body bob. */
    delay: 40,
  },
  hands: {
    /** Pendulum pivot height above the hand; the arc's radius. Higher = flatter arc. */
    pivotHeight: 0.35,
    /** Peak swing angle along the arc; positive = outward, away from the body. */
    swing: 6,
    /** Degrees the swing trails behind the body bob. */
    delay: 70,
    /** Hand tilt relative to the arc angle (0 = hangs straight from pivot). */
    tiltOffset: 0,
    /** Phase difference between hands: 0 = mirrored (both out together), 180 = alternating. */
    sidePhase: 0,
  },
};

/**
 * Jog tuning. Phase runs on distance: one cycle = two steps = `strideLength`
 * of ground. Left foot strikes at 0°, right foot at 180°.
 */
const JOG1 = {
  /** Treadmill speed used by the inspector (the game uses actual speed). */
  speed: 2.6,
  /** Ground covered per cycle (two steps) at `speed`. Grows gently when faster. */
  strideLength: 1.3,
  /** Fraction of the cycle each foot is planted. Under 0.5 = moments with both feet in the air. */
  stance: 0.36,
  foot: {
    /** Peak height of a swinging foot. */
    lift: 0.1,
    /** Toe-down after push-off, toe-up before strike. */
    pitch: 18,
    /**
     * 0–1. How much the swinging foot matches ground speed as it leaves and
     * meets the ground. 0 = stops/starts instantly (snappy), 1 = eases off and
     * on like a real foot (smooth).
     */
    plantMatch: 0,
    /** Shape of the lift arc. 1 = leaves the ground at full speed; higher = softer lift-off and touchdown. */
    liftPower: 1,
  },
  body: {
    /** Up/down travel of the running bounce (two bounces per cycle). */
    bounce: 0.03,
    /** Degrees after a footstrike where the bounce bottoms out. */
    lowPoint: 45,
    /** The stutter: an extra dip right as a foot lands. */
    impact: {
      /**
       * 'sharp' = instant jolt that decays (punchy, but a velocity spike).
       * 'smooth' = eased dip over `duration` (no spike).
       */
      curve: 'sharp' as 'sharp' | 'smooth',
      /** How far the body dips. */
      depth: 0.025,
      /** Sharp: degrees until the jolt peaks. Smooth: degrees the whole dip lasts. */
      duration: 18,
      /** Forward nod of the body at the jolt, degrees. */
      nod: 2.5,
    },
    /** Constant forward lean. */
    lean: 10,
    /** Shoulder counter-twist against the legs. Low = square, guarded. */
    twist: 7,
    /** Side-to-side lean toward the planted foot. */
    roll: 3,
  },
  /**
   * The head is not attached to the torso: it copies the torso's up/down
   * motion with a delay, and sits above the steady lean. It doesn't inherit
   * the torso's twist, roll or impact nod.
   */
  head: {
    /** Degrees (of the 180° step) the head's copy of the torso bob runs late. */
    delay: 30,
    /** How much of the torso bob the head copies (1 = all of it). */
    follow: 1,
    /** Soft forward/back bob, furthest forward at the bottom of each (delayed) dip. */
    forward: 0,
  },
  hands: {
    /** Guard position relative to the hand's rest spot by the hip. */
    guard: {
      /** Toward the centre line. */
      inward: 0.17,
      /** Up from the hip. */
      up: 0.36,
      /** Forward of the body. */
      forward: 0.2,
    },
    /** Forward/back pump, opposite to the same-side foot. Small = fighter, big = sprinter. */
    pump: 0.045,
    /** Extra rise on the forward pump. */
    lift: 0.015,
    /** Like head.lag: how late the hands follow the body's vertical motion. */
    lag: 0.5,
    delay: 45,
    /** Hand pitch in guard (negative = top of hand back). */
    tilt: -15,
    /** Hands turn toward the centre line (negative = turn out). */
    turnIn: 15,
    /** Top of the hand tips outward, away from the body. */
    flare: 0,
  },
  blend: {
    /** Ground speed at which the jog is fully blended in. */
    fullAt: 1.2,
    /** How quickly idle ↔ jog blends (higher = snappier). */
    rate: 8,
  },
};

/** Position offset (units) and rotation (radians) for one part. */
export interface PartPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/**
 * - body: offset from the waist rest height, rotation about the waist.
 * - head: offset from its rest spot above the waist (not attached to the body).
 * - hands: pivot transform inside the part's anchor (attached to the body).
 * - feet: offset from rest on the ground, rx = pitch, ry = extra yaw.
 */
export interface Pose {
  body: PartPose;
  head: PartPose;
  handL: PartPose;
  handR: PartPose;
  footL: PartPose;
  footR: PartPose;
}

const KEYS = ['body', 'head', 'handL', 'handR', 'footL', 'footR'] as const;
const rad = THREE.MathUtils.degToRad;

const part = (p: Partial<PartPose> = {}): PartPose => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ...p });

/** Sine of a phase in degrees: −1…1, one full wave per 360°. */
export const wave = (deg: number) => Math.sin(rad(deg));
const cosd = (deg: number) => Math.cos(rad(deg));

/** Linear blend of two poses, `w` = 0 → a, 1 → b. */
export function blendPose(a: Pose, b: Pose, w: number): Pose {
  const out = {} as Pose;
  for (const k of KEYS) {
    const pa = a[k];
    const pb = b[k];
    out[k] = part({
      x: pa.x + (pb.x - pa.x) * w,
      y: pa.y + (pb.y - pa.y) * w,
      z: pa.z + (pb.z - pa.z) * w,
      rx: pa.rx + (pb.rx - pa.rx) * w,
      ry: pa.ry + (pb.ry - pa.ry) * w,
      rz: pa.rz + (pb.rz - pa.rz) * w,
    });
  }
  return out;
}

export type JogConfig = typeof JOG1;

/** Jog 2: copy of Jog 1, with only these changes. */
const JOG2 = derive(JOG1, {
  foot: {
    lift: 0.16, // more prominent steps
    pitch: 26,
    plantMatch: 1, // feet ease off and onto the ground
    liftPower: 1.6,
  },
  body: {
    bounce: 0.045,
    impact: { curve: 'smooth', depth: 0.035, duration: 70, nod: 3 }, // clear but eased landings
    lean: 5, // half the forward tilt
  },
  head: {
    follow: 0.5, // half the copied bob
    forward: 0.02, // soft forward bob
  },
  hands: {
    guard: { inward: -0.03, up: 0.18, forward: 0.12 }, // lower, out to the sides
    pump: 0.06,
    turnIn: -7.5, // turned out: open, extroverted
    flare: 10,
  },
});

/**
 * Zombie shamble: a slow walk built on the jog. Stance over 0.5 means a foot
 * is always down (walking, not running). Arms reach forward, head droops.
 */
const SHAMBLE = derive(JOG1, {
  speed: 1.1,
  strideLength: 1.0,
  stance: 0.62,
  foot: { lift: 0.05, pitch: 8, plantMatch: 1, liftPower: 1.4 },
  body: {
    bounce: 0.015,
    lowPoint: 20,
    impact: { curve: 'smooth', depth: 0.02, duration: 90, nod: 4 }, // heavy, dragging steps
    lean: 14,
    twist: 10,
    roll: 6, // lurches side to side
  },
  head: { delay: 50, follow: 1, forward: 0.03 },
  hands: {
    guard: { inward: 0.06, up: 0.32, forward: 0.38 }, // arms out in front
    pump: 0.02,
    lift: 0,
    lag: 0.8,
    delay: 70,
    tilt: -70, // hands lie flat, reaching
    turnIn: 0,
    flare: 0,
  },
  blend: { fullAt: 0.6, rate: 6 },
});

export const JOGS = { jog1: JOG1, jog2: JOG2, shamble: SHAMBLE };
export type JogStyle = keyof typeof JOGS;

// ─── Idle ────────────────────────────────────────────────────────────────

export function idlePose(phase: number): Pose {
  const p = phase + IDLE.bob.phaseOffset;
  const h = IDLE.hands;
  return {
    body: part({ y: IDLE.bob.height * wave(p) }),
    // Same as riding on the body: body bob + the extra, delayed head bob.
    head: part({ y: IDLE.bob.height * wave(p) + IDLE.head.height * wave(p - IDLE.head.delay) }),
    handL: pendulum(1, wave(p - h.delay) * h.swing),
    handR: pendulum(-1, wave(p - h.delay + h.sidePhase) * h.swing),
    footL: part(),
    footR: part(),
  };
}

/**
 * Hand on a sideways pendulum arc hanging from a pivot `pivotHeight` above its
 * rest point. Positive angles swing outward (`side` +1 = +X hand). The hand
 * tilts with the arc so it keeps "hanging" from the pivot, plus `tiltOffset`.
 */
function pendulum(side: 1 | -1, angleDeg: number): PartPose {
  const r = IDLE.hands.pivotHeight;
  const a = rad(angleDeg);
  return part({
    x: side * r * Math.sin(a),
    y: r - r * Math.cos(a),
    rz: side * rad(angleDeg + IDLE.hands.tiltOffset),
  });
}

// ─── Jog ─────────────────────────────────────────────────────────────────

/** Stride for a given speed: longer steps when faster, so cadence doesn't run away. */
export function strideAt(speed: number, cfg: JogConfig = JOG1): number {
  return cfg.strideLength * Math.max(1, Math.sqrt(speed / cfg.speed));
}

/** Quick dip-and-recover shape: 0 at x=0, peaks at 1 when x=1, then decays. */
const jolt = (x: number) => (x <= 0 ? 0 : x * Math.exp(1 - x));

/** Eased bump: 0 at x=0, 1 at x=0.5, 0 at x≥1, starting and ending at zero speed. */
const bump = (x: number) => (x <= 0 || x >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * x));

/** Impact shape (0–1) at `stepDeg` degrees after a footstrike. */
function impactAt(cfg: JogConfig, stepDeg: number): number {
  const { curve, duration } = cfg.body.impact;
  return curve === 'smooth' ? bump(stepDeg / duration) : jolt(stepDeg / duration);
}

/** Body height offset at a step phase (degrees since the last footstrike, 0–180). */
function bodyHeight(cfg: JogConfig, stepDeg: number): number {
  const b = cfg.body;
  const s = ((stepDeg % 180) + 180) % 180;
  // Two bounces per cycle: period 180°, lowest at `lowPoint`.
  const bounce = -b.bounce * cosd(2 * (s - b.lowPoint));
  return bounce - b.impact.depth * impactAt(cfg, s);
}

/** @param headHeight head centre above the waist, so the head can sit over the leaned torso. */
export function jogPose(phase: number, stride: number, cfg: JogConfig = JOG1, headHeight = 0): Pose {
  const b = cfg.body;
  const step = phase % 180;
  const y = bodyHeight(cfg, step);

  const body = part({
    y,
    rx: rad(b.lean + b.impact.nod * impactAt(cfg, step)),
    // Left foot forward at 0° → left (+X) shoulder back.
    ry: rad(b.twist * cosd(phase)),
    // Lean toward whichever foot is planted (left stance centres at stance·180°).
    rz: -rad(b.roll * cosd(phase - cfg.stance * 180)),
  });

  // Delayed copy of the torso bob; forward by the steady lean so it stays
  // centred over the torso (the lean pivots at the waist).
  const lean = rad(b.lean);
  const hd = cfg.head;
  const headStep = step - hd.delay;
  const head = part({
    y: hd.follow * bodyHeight(cfg, headStep) - headHeight * (1 - Math.cos(lean)),
    // Two per cycle, peaking forward where the bounce bottoms out.
    z: headHeight * Math.sin(lean) + hd.forward * cosd(2 * (headStep - b.lowPoint)),
  });

  return {
    body,
    head,
    handL: guardHand(cfg, 1, phase, y),
    handR: guardHand(cfg, -1, phase, y),
    footL: jogFoot(cfg, phase, stride),
    footR: jogFoot(cfg, phase + 180, stride),
  };
}

/** Fists up in front of the chest with a tight pump, opposite to the same-side foot. */
function guardHand(cfg: JogConfig, side: 1 | -1, phase: number, bodyY: number): PartPose {
  const h = cfg.hands;
  // Left foot is forward at 0°, so the left hand is back then.
  const pump = -side * cosd(phase);
  const lagY = h.lag * (bodyHeight(cfg, (phase % 180) - h.delay) - bodyY);
  return part({
    x: -side * h.guard.inward,
    // Rises as the hand pumps forward; squared so it has no corner at the turn.
    y: h.guard.up + h.lift * ((1 + pump) / 2) ** 2 + lagY,
    z: h.guard.forward + h.pump * pump,
    rx: rad(h.tilt),
    ry: -side * rad(h.turnIn),
    rz: -side * rad(h.flare),
  });
}

/**
 * One foot over the cycle (strike at phase 0). Planted: slides back under the
 * body at exactly ground speed (so it stays still in the world). Swinging:
 * lifts and eases forward to the next strike.
 */
function jogFoot(cfg: JogConfig, phase: number, stride: number): PartPose {
  const u = (((phase % 360) + 360) % 360) / 360;
  const stance = cfg.stance;
  const reach = stride * stance; // ground the body covers while this foot is down
  if (u < stance) {
    const t = u / stance;
    return part({ z: reach / 2 - t * reach });
  }
  const s = (u - stance) / (1 - stance);
  const { lift, pitch, plantMatch, liftPower } = cfg.foot;
  // Ease forward. The extra s(1-s)(1-2s) term sets the speed at both ends to
  // the planted foot's speed (scaled by plantMatch) without moving the ends.
  const plantSpeed = -stride * (1 - stance) * plantMatch;
  const arc = Math.sin(Math.PI * s);
  return part({
    z: -reach / 2 + (reach * (1 - Math.cos(Math.PI * s))) / 2 + plantSpeed * s * (1 - s) * (1 - 2 * s),
    y: lift * Math.pow(arc, liftPower),
    // Same softening on the toe pitch so the foot doesn't slap at the ends.
    rx: rad(pitch) * Math.sin(2 * Math.PI * s) * Math.pow(arc, liftPower - 1),
  });
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Deep copy of `base` with `changes` merged in. */
function derive<T extends object>(base: T, changes: DeepPartial<T>): T {
  const out = structuredClone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(changes)) {
    out[k] = v && typeof v === 'object' ? derive(out[k] as object, v as object) : v;
  }
  return out as T;
}

// ─── Melee swing ─────────────────────────────────────────────────────────

/**
 * Right-handed melee swing. A one-shot on a normalized 0–1 timeline, scaled
 * to `duration` seconds; angles are actual rotation angles. Segment lengths
 * are shares of the timeline (scaled to fit if they don't sum to 1), so
 * `duration` changes the speed without changing the feel.
 *
 * Every channel below is keyed at three moments —
 * `windup` (end of windup, held through the hold), `strike` (end of burst)
 * and the follow-through — and returns to neutral in the recovery. All
 * channels share the same timing and easing, so they stay in sync.
 *
 * Torso: yaw negative = right (−X) shoulder back, tilt negative = lean back.
 * Everything except the feet is relative to the torso.
 */
export const SWING = {
  /** Seconds for the whole swing. */
  duration: 0.61,
  /** Point the torso rotates around, relative to the waist centre (+X = left side). */
  pivot: { x: 0.2, z: 0 },
  windup: {
    /** Share of the swing from neutral to full windup (eases in and out). */
    length: 0.31,
    /** Turn away: right shoulder back. */
    yaw: -30,
    /** Lean back. */
    tilt: -10,
  },
  /** Share spent paused at the top of the windup (anticipation). */
  hold: 0.05,
  burst: {
    /** Share from windup to strike; accelerates into the hit. */
    length: 0.13,
    /** Strike angle: right shoulder forward (windup −30 → +30 = 60° of travel). */
    yaw: 30,
    /** Lean into the strike. */
    tilt: 8,
  },
  followThrough: {
    /** Share past the strike, decelerating. */
    length: 0.1,
    /** Extra degrees of torso yaw past the strike angle before settling. */
    overshoot: 8,
  },
  /** Share back to neutral. */
  recovery: 0.41,

  head: {
    /** How much the head turns with the torso: 0 = stays facing forward, 1 = turns fully. */
    rotationFollow: 0,
    /** Forward bob in the torso's forward direction (negative = back). */
    forward: { windup: 0, strike: 0.04 },
  },
  feet: {
    /** Right foot slides along the ground: back in the windup, forward on the strike. */
    rightSlide: { windup: -0.08, strike: 0.06 },
    /** Left foot stays planted and turns further outward (degrees on top of its splay). */
    leftTurnOut: { windup: 10, strike: 25 },
  },
  /**
   * Right (sword) hand. Position is relative to the torso, so the torso's
   * twist amplifies it. Each channel: windup / strike / optional follow
   * (follow-through; defaults to strike).
   */
  handR: {
    /** Out to the side, away from the body. */
    out: { windup: 0.1, strike: 0.1 },
    /** Forward (negative = back). */
    forward: { windup: -0.1, strike: 0.18 },
    /** Up from the hip: raised in the windup so the blow comes down. */
    up: { windup: 0.45, strike: 0.1 },
    /**
     * Where the blade points, from the base grip (straight forward, level).
     * Relative to the character's facing, not the torso, unless rotationFollow > 0.
     */
    aim: {
      /** 0 = aim is relative to facing (torso twist doesn't turn the blade), 1 = rides the torso. */
      rotationFollow: 0,
      /** Tip left (+) / right (−), degrees. */
      yaw: { windup: -60, strike: 15, follow: 25 }, // flared out right → lands near forward
      /** Tip up (+) / down (−), degrees. 90 = straight up. */
      pitch: { windup: 55, strike: -8, follow: -12 },
      /** Spin around the blade: + turns the bottom edge toward the left. 45 = edge leads down-left. */
      roll: { windup: 45, strike: 45 },
    },
  },
};

/** Segment shares, normalized to sum to 1: windup, hold, burst, follow-through, recovery. */
function swingShares(): number[] {
  const { windup, hold, burst, followThrough, recovery } = SWING;
  const raw = [windup.length, hold, burst.length, followThrough.length, recovery];
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((r) => r / total);
}

export const SWING_SEGMENTS = ['windup', 'hold', 'burst', 'follow-through', 'recovery'] as const;

/** Total swing length in seconds. */
export function swingDuration(): number {
  return SWING.duration;
}

/** Moment of impact (end of burst) on the 0–1 timeline. */
export function swingImpact(): number {
  const [w, h, b] = swingShares();
  return w + h + b;
}

/** Seconds from swing start to the moment of impact. */
export function swingImpactTime(): number {
  return swingImpact() * SWING.duration;
}

const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const SEGMENT_EASE = [easeInOut, easeInOut, easeIn, easeOut, easeInOut];

/**
 * Where `u` (0–1) falls on the swing timeline: segment index and eased progress.
 * Segments: 0 windup, 1 hold, 2 burst, 3 follow-through, 4 recovery.
 */
export function swingSegment(u: number): { i: number; k: number } {
  const shares = swingShares();
  for (let i = 0; i < shares.length; i++) {
    const len = shares[i];
    if (u < len) return { i, k: SEGMENT_EASE[i](len > 0 ? u / len : 1) };
    u -= len;
  }
  return { i: 4, k: 1 };
}

/** A keyed channel: values at the end of windup, strike and (optionally) follow-through. */
interface Channel {
  windup: number;
  strike: number;
  follow?: number;
}

const key = (seg: { i: number; k: number }, c: Channel) => track(seg, c.windup, c.strike, c.follow ?? c.strike);

/** A channel's value at a timeline position, from its windup / strike / follow-through keys. */
function track(seg: { i: number; k: number }, windup: number, strike: number, follow = strike): number {
  // Value at the start of each segment, plus the final neutral.
  const keys = [0, windup, windup, strike, follow, 0];
  return keys[seg.i] + (keys[seg.i + 1] - keys[seg.i]) * seg.k;
}

/**
 * Pose at `u` (0–1) along the swing.
 * @param headHeight head centre above the waist, so the head can follow the torso.
 */
export function swingPose(u: number, headHeight = 0): Pose {
  const seg = swingSegment(u);
  const S = SWING;

  const yaw = track(seg, S.windup.yaw, S.burst.yaw, S.burst.yaw + S.followThrough.overshoot);
  const tilt = track(seg, S.windup.tilt, S.burst.tilt);
  const rot = new THREE.Euler(rad(tilt), rad(yaw), 0, 'YXZ');
  // Rotate about the side pivot, not the waist centre: shift the body so the
  // pivot point stays put (offset = P − R·P).
  const pivot = new THREE.Vector3(S.pivot.x, 0, S.pivot.z);
  const offset = pivot.clone().sub(pivot.clone().applyEuler(rot));

  // Head: carried by the torso (as if attached headHeight above the waist,
  // plus the forward bob in the torso's frame), but only turns by rotationFollow.
  const headLocal = new THREE.Vector3(0, headHeight, track(seg, S.head.forward.windup, S.head.forward.strike));
  const headPos = headLocal.applyEuler(rot).add(offset).sub(new THREE.Vector3(0, headHeight, 0));
  const f = S.head.rotationFollow;

  const slide = S.feet.rightSlide;
  const turn = S.feet.leftTurnOut;
  return {
    body: part({ x: offset.x, y: offset.y, z: offset.z, rx: rot.x, ry: rot.y }),
    head: part({ x: headPos.x, y: headPos.y, z: headPos.z, rx: rot.x * f, ry: rot.y * f }),
    handL: part(),
    handR: swingHand(seg, rot),
    footL: part({ ry: rad(track(seg, turn.windup, turn.strike)) }),
    footR: part({ z: track(seg, slide.windup, slide.strike) }),
  };
}

/**
 * Right hand during the swing: position relative to the torso, blade aim
 * relative to facing (blended toward the torso by rotationFollow). The hand
 * pivot sits inside the torso, so its rotation has to undo the torso's to
 * aim in facing space.
 */
function swingHand(seg: { i: number; k: number }, body: THREE.Euler): PartPose {
  const h = SWING.handR;
  const aim = h.aim;
  const facingAim = new THREE.Quaternion().setFromEuler(
    // Tip starts along +Z: yaw about Y, then pitch (rx < 0 tips up), then roll about the blade.
    new THREE.Euler(-rad(key(seg, aim.pitch)), rad(key(seg, aim.yaw)), rad(key(seg, aim.roll)), 'YXZ'),
  );
  const undoTorso = new THREE.Quaternion().setFromEuler(body).invert();
  const towardTorso = new THREE.Quaternion().slerp(undoTorso, 1 - aim.rotationFollow);
  const local = new THREE.Euler().setFromQuaternion(towardTorso.multiply(facingAim), 'XYZ');
  return part({
    x: -key(seg, h.out), // right hand is on the −X side, so "out" is −X
    y: key(seg, h.up),
    z: key(seg, h.forward),
    rx: local.x,
    ry: local.y,
    rz: local.z,
  });
}
