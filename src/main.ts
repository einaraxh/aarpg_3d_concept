import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Character } from './character';
import { resolveStatic, separateAgents } from './collision';
import { COMBAT, Fighter, inSwing, shatter, showDamage, updateDamageText, updateWrecks } from './combat';
import { Input } from './input';
import { Inspector } from './inspector';
import { createLoadoutPanel, ITEMS, type Loadout } from './loadout';
import { FlowField } from './pathing';
import { LowRes, RETRO } from './retro';
import { spawnShowcase } from './showcase';
import { swordReach } from './sword';
import { buildWorld, followShadow } from './world';
import { ZombieSpawner } from './zombie';

const WALK_SPEED = 2.6;
const RUN_SPEED = 5.5;
const ACCEL = 14;
const TURN_RATE = 12;
/** Classic ARPG angle: camera sits behind-and-above, rotated 45° around Y. */
const CAMERA_OFFSET = new THREE.Vector3(9, 13, 9);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Overlay for HTML labels that track 3D positions; clicks pass through to the canvas.
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', top: '0', pointerEvents: 'none' });
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 200);

const { ground, obstacles } = buildWorld(scene);
const updateShowcase = spawnShowcase(scene, obstacles);
const player = new Character();
scene.add(player.root);
const hero = new Fighter(player, COMBAT.player.hp, COMBAT.player.radius, COMBAT.player.mass);

const flow = new FlowField(obstacles);
const spawner = new ZombieSpawner(scene, obstacles, flow);
let respawnIn = 0;

const input = new Input(renderer.domElement, camera, ground);

// Low-res mode: orthographic, pixelated, 4:3 with dark borders. Remembered across reloads.
const RETRO_KEY = 'arpg-retro';
const lowRes = new LowRes();
let retro = readRetro();
let inspectorOpen = false;
const retroButton = document.createElement('button');
retroButton.textContent = 'Low-res [L]';
retroButton.addEventListener('click', () => setRetro(!retro));

const hud = document.getElementById('hud')!;
const status = document.getElementById('status')!;
const hpFill = document.querySelector<HTMLDivElement>('#status .fill')!;
const hpText = document.querySelector<HTMLSpanElement>('#status .hp')!;
const killText = document.querySelector<HTMLSpanElement>('#status .kills')!;
const inspector = new Inspector(renderer.domElement, (open) => {
  input.enabled = !open;
  input.reset();
  labelRenderer.domElement.style.display = open ? 'none' : '';
  status.hidden = open;
  inspectorOpen = open;
  layout();
  hud.textContent = open
    ? 'Inspector · Left-drag rotate · Right-drag pan · Scroll zoom'
    : 'WASD to move · Shift to run · Left-click to attack · Scroll to zoom';
});
inspector.resize(window.innerWidth, window.innerHeight);
document.getElementById('toolbar')!.prepend(retroButton);
layout();
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.code !== 'KeyL' || inspector.isOpen) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  setRetro(!retro);
});

let loadout: Loadout = { item: 'none', slot: 'back' };
createLoadoutPanel((l) => {
  loadout = { ...l };
  player.equip(loadout);
  inspector.character.equip(loadout);
  inspector.refresh();
});

const velocity = hero.velocity;

// Screen-space WASD → world directions, derived from the camera's yaw.
const camForward = new THREE.Vector3(-CAMERA_OFFSET.x, 0, -CAMERA_OFFSET.z).normalize();
const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0));

function updatePlayer(dt: number): void {
  const pos = player.root.position;
  const desired = new THREE.Vector3();

  // Left-click: face the clicked point and swing. Movement stops while swinging.
  if (input.attackTarget) {
    if (!player.isSwinging) {
      const to = input.attackTarget.clone().sub(pos);
      if (to.lengthSq() > 1e-4) player.root.rotation.y = Math.atan2(to.x, to.z);
      velocity.set(0, 0, 0);
      player.swing();
    }
    input.attackTarget = null;
  }

  const axis = input.axis();
  if (axis.lengthSq() > 0 && !player.isSwinging) {
    desired.addScaledVector(camRight, axis.x).addScaledVector(camForward, axis.y);
  }

  const maxSpeed = input.running ? RUN_SPEED : WALK_SPEED;
  desired.multiplyScalar(maxSpeed);
  velocity.x = THREE.MathUtils.damp(velocity.x, desired.x, ACCEL, dt);
  velocity.z = THREE.MathUtils.damp(velocity.z, desired.z, ACCEL, dt);

  pos.addScaledVector(velocity, dt);

  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed > 0.05 && !player.isSwinging) {
    const yaw = Math.atan2(velocity.x, velocity.z);
    player.root.rotation.y = dampAngle(player.root.rotation.y, yaw, TURN_RATE, dt);
  }

  player.jogStyle = inspector.jogStyle;
  player.update(dt, speed);
  hero.updateFx(dt);

  // The swing lands at its impact moment: hit every zombie in the cone.
  if (player.struck) {
    const armed = loadout.item !== 'none' && loadout.slot === 'hand';
    const damage = armed ? ITEMS[loadout.item as keyof typeof ITEMS].damage : COMBAT.player.unarmed.damage;
    const reach = armed ? COMBAT.handReach + swordReach(ITEMS[loadout.item as keyof typeof ITEMS].size).tip : COMBAT.player.unarmed.reach;
    for (const z of [...spawner.zombies]) {
      if (z.rising || !inSwing(hero, z, reach, COMBAT.player.arc)) continue;
      const taken = z.takeHit(damage, pos, COMBAT.player.knockback);
      showDamage(scene, z.pos, taken, '#ffd36b');
      if (z.dead) spawner.kill(z, pos);
    }
  }
}

/** Zombies chase and attack; the player dies and respawns. */
function updateCombat(dt: number): void {
  flow.update(dt, player.root.position);
  spawner.update(dt, hero);
  for (const z of spawner.zombies) {
    z.update(dt, hero, flow, (damage) => {
      const taken = hero.takeHit(damage, z.pos, COMBAT.player.knockback / 2);
      showDamage(scene, hero.pos, taken, '#ff6b6b');
      if (hero.dead) {
        shatter(scene, player, z.pos, false);
        velocity.set(0, 0, 0);
        respawnIn = COMBAT.player.respawnDelay;
      }
    });
  }

  // Collisions: agents shove each other apart, then everyone is pushed out of the scenery.
  const agents = hero.dead ? [...spawner.zombies] : [hero, ...spawner.zombies];
  separateAgents(agents);
  for (const a of agents) resolveStatic(a.pos, a.radius, obstacles);

  if (hero.dead && (respawnIn -= dt) <= 0) {
    hero.health.reset();
    player.root.position.set(0, 0, 0);
    player.root.visible = true;
    spawner.reset();
  }

  updateWrecks(dt);
  updateDamageText(dt);

  hpFill.style.width = `${hero.health.fraction * 100}%`;
  hpText.textContent = hero.dead ? `Dead · respawn in ${Math.ceil(respawnIn)}` : `${hero.health.hp} / ${hero.health.max}`;
  killText.textContent = `Kills ${spawner.kills}`;
}

function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * (1 - Math.exp(-lambda * dt));
}

const camTarget = new THREE.Vector3();
function updateCamera(dt: number): void {
  const focus = player.root.position.clone().setY(1);
  camTarget.lerp(focus, 1 - Math.exp(-8 * dt));
  camera.position.copy(camTarget).addScaledVector(CAMERA_OFFSET, input.zoom);
  camera.lookAt(camTarget);
  lowRes.aim(camTarget, CAMERA_OFFSET, input.zoom);
  followShadow(scene, player.root.position);
}

function setRetro(on: boolean): void {
  retro = on;
  try {
    localStorage.setItem(RETRO_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  layout();
}

function readRetro(): boolean {
  try {
    return localStorage.getItem(RETRO_KEY) === '1';
  } catch {
    return false;
  }
}

/** Size the canvas and labels: full window, or the centred 4:3 low-res frame. */
function layout(): void {
  const on = retro && !inspectorOpen;
  retroButton.classList.toggle('on', retro);
  retroButton.hidden = inspectorOpen;
  document.body.style.background = on ? RETRO.border : '';
  input.camera = on ? lowRes.camera : camera;
  const els = [renderer.domElement, labelRenderer.domElement];
  if (on) {
    const f = lowRes.frame();
    renderer.setPixelRatio(1);
    renderer.setSize(f.device[0], f.device[1], false);
    labelRenderer.setSize(f.width, f.height);
    for (const el of els) {
      Object.assign(el.style, { position: 'fixed', left: `${f.left}px`, top: `${f.top}px`, width: `${f.width}px`, height: `${f.height}px` });
    }
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    for (const el of els) Object.assign(el.style, { left: '0', top: '0' });
  }
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => {
  layout();
  inspector.resize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
camTarget.set(0, 1, 0);
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (inspector.isOpen) {
    inspector.update(dt);
    renderer.render(inspector.scene, inspector.camera);
    return;
  }
  if (!hero.dead) updatePlayer(dt);
  updateCombat(dt);
  updateCamera(dt);
  updateShowcase(clock.elapsedTime);
  if (retro) {
    lowRes.render(renderer, scene);
    labelRenderer.render(scene, lowRes.camera);
  } else {
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
});

// Exposed for debugging in the console.
Object.assign(window, { scene, player, hero, spawner, inspector });
