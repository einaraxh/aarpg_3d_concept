import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { JOGS, SWING_SEGMENTS, swingDuration, swingSegment, type JogStyle } from './animation';
import { Character } from './character';
import { makeSword } from './sword';

const STORAGE_KEY = 'inspector';
const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x000000 });
const WIRE_MAT = new THREE.LineBasicMaterial({ color: 0x1b1f27 });

interface Settings {
  open: boolean;
  edges: boolean;
  wireframe: boolean;
  /** Index into the subject list. */
  subject: number;
  /** Animation previewed on the character. */
  anim: Anim;
  /** Last jog variant previewed; the game character uses it too. */
  jog: JogStyle;
  /** Hold the character at `scrub` instead of playing. */
  frozen: boolean;
  /** Position on the current animation's 0–1 cycle while frozen. */
  scrub: number;
}

const ANIMS = ['idle', 'jog1', 'jog2', 'shamble', 'swing'] as const;
type Anim = (typeof ANIMS)[number];
const ANIM_LABELS: Record<Anim, string> = { idle: 'Idle', jog1: 'Jog 1', jog2: 'Jog 2', shamble: 'Shamble (zombie)', swing: 'Swing' };
const ANIM_KIND: Record<Anim, 'idle' | 'jog' | 'swing'> = { idle: 'idle', jog1: 'jog', jog2: 'jog', shamble: 'jog', swing: 'swing' };
/** Pause between looped swings in the preview, seconds. */
const SWING_GAP = 0.6;

type Toggle = 'open' | 'edges' | 'wireframe';

interface Subject {
  name: string;
  root: THREE.Object3D;
  update?: (dt: number) => void;
}

/**
 * Standalone view for inspecting models (character, sword, …): orbit camera,
 * light background, hard-edge outlines and a faces-hidden wireframe mode.
 * Builds its own instances, so it always reflects the current code.
 */
export class Inspector {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private controls: OrbitControls;
  private subjects: Subject[];
  readonly character = new Character();
  private settings: Settings = { open: false, edges: true, wireframe: false, subject: 0, anim: 'idle', jog: 'jog1', frozen: false, scrub: 0 };
  private buttons = new Map<Toggle, HTMLButtonElement>();
  private subjectButton = document.createElement('button');
  private animButton = document.createElement('button');
  private scrubBar = document.createElement('div');
  private freezeButton = document.createElement('button');
  private slider = document.createElement('input');
  private readout = document.createElement('span');
  private shownSubject = -1;
  private swingGap = 0;

  constructor(canvas: HTMLCanvasElement, private onToggle: (open: boolean) => void) {
    this.scene.background = new THREE.Color(0xd9dce3);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.6));
    // Key light rides on the camera so the side you look at is always lit.
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.5, 2);
    this.camera.add(key);
    this.scene.add(this.camera);

    const grid = new THREE.GridHelper(4, 40, 0x9aa1ae, 0xbfc4cd);
    this.scene.add(grid, new THREE.AxesHelper(0.3));

    const character = this.character;
    const sword = makeSword();
    sword.position.y = 0.3; // lift the grip so the whole sword clears the grid
    this.subjects = [
      // Jog runs on a treadmill: the body stays put while the feet cycle under it.
      {
        name: 'Character',
        root: character.root,
        update: (dt) => {
          const { anim } = this.settings;
          const kind = ANIM_KIND[anim];
          // The shamble previews here only; the player keeps the last jog picked.
          character.jogStyle = anim === 'shamble' ? 'shamble' : this.settings.jog;
          if (this.settings.frozen) {
            character.preview(kind, this.settings.scrub);
            this.showProgress(this.settings.scrub);
            return;
          }
          if (anim === 'swing') {
            // Loop: swing, pause, swing again.
            if (!character.isSwinging && (this.swingGap += dt) >= SWING_GAP) {
              this.swingGap = 0;
              character.swing();
            }
            character.update(dt, 0);
          } else {
            character.update(dt, anim === 'idle' ? 0 : JOGS[anim].speed);
          }
          this.showProgress(character.progress(kind));
        },
      },
      { name: 'Sword', root: sword },
    ];
    for (const s of this.subjects) this.scene.add(s.root);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 10;

    this.load();
    this.buildUI();
    this.apply();

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'KeyI') this.toggle('open');
      if (!this.settings.open) return;
      if (e.code === 'KeyE') this.toggle('edges');
      if (e.code === 'KeyG') this.toggle('wireframe');
      if (e.code === 'KeyS') this.nextSubject();
      if (e.code === 'KeyA') this.nextAnim();
      if (e.code === 'KeyF') this.toggleFreeze();
    });
  }

  get jogStyle(): JogStyle {
    return this.settings.jog;
  }

  get isOpen(): boolean {
    return this.settings.open;
  }

  update(dt: number): void {
    this.subjects[this.settings.subject].update?.(dt);
    this.controls.update();
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Call after models change (e.g. equipping an item) to outline new meshes. */
  refresh(): void {
    this.apply();
  }

  /**
   * Give every mesh outline + wireframe line sets (once), then set what's
   * visible. Runs on each apply so meshes added later get overlays too.
   */
  private applyOverlays(): void {
    const { edges, wireframe } = this.settings;
    const meshes: THREE.Mesh[] = [];
    this.scene.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
    for (const o of meshes) {
      let overlay = o.userData.overlay as { edges: THREE.LineSegments; wire: THREE.LineSegments } | undefined;
      if (!overlay) {
        // 15° threshold: only hard creases, not the diagonals of flat quads.
        overlay = {
          edges: new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 15), EDGE_MAT),
          wire: new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), WIRE_MAT),
        };
        o.add(overlay.edges, overlay.wire);
        o.userData.overlay = overlay;
      }
      // Material.visible hides only the faces; the child line sets still draw.
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.visible = !wireframe;
      overlay.wire.visible = wireframe;
      overlay.edges.visible = edges && !wireframe;
    }
  }

  private toggleFreeze(): void {
    const { anim, frozen } = this.settings;
    // Freeze where the animation currently is, so nothing jumps.
    if (!frozen) this.settings.scrub = this.character.progress(ANIM_KIND[anim]);
    this.settings.frozen = !frozen;
    this.apply();
    this.save();
  }

  /** Move the slider and readout to `u` without touching the settings. */
  private showProgress(u: number): void {
    if (document.activeElement !== this.slider || this.settings.frozen) this.slider.value = String(u);
    const kind = ANIM_KIND[this.settings.anim];
    let text = u.toFixed(3);
    if (kind === 'swing') {
      text += ` · ${(u * swingDuration()).toFixed(3)} s · ${SWING_SEGMENTS[swingSegment(u).i]}`;
    } else {
      text += ` · ${(u * 360).toFixed(0)}°`;
    }
    this.readout.textContent = text;
  }

  private nextAnim(): void {
    this.settings.anim = ANIMS[(ANIMS.indexOf(this.settings.anim) + 1) % ANIMS.length];
    const anim = this.settings.anim;
    if (anim === 'jog1' || anim === 'jog2') this.settings.jog = anim;
    this.apply();
    this.save();
  }

  private nextSubject(): void {
    this.settings.subject = (this.settings.subject + 1) % this.subjects.length;
    this.apply();
    this.save();
  }

  /** Point the camera at the whole subject from a front three-quarter angle. */
  private frame(root: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.5, 1.6).normalize().multiplyScalar(size * 2.2));
    this.controls.target.copy(center);
    this.controls.update();
  }

  private toggle(key: Toggle): void {
    this.settings[key] = !this.settings[key];
    this.apply();
    this.save();
  }

  private apply(): void {
    const { open } = this.settings;
    if (!this.subjects[this.settings.subject]) this.settings.subject = 0;
    const subject = this.subjects[this.settings.subject];
    this.subjects.forEach((s) => (s.root.visible = s === subject));
    if (this.shownSubject !== this.settings.subject) {
      this.shownSubject = this.settings.subject;
      this.frame(subject.root);
    }
    this.subjectButton.textContent = `${subject.name} [S]`;
    this.subjectButton.hidden = !open;
    if (!ANIMS.includes(this.settings.anim)) this.settings.anim = 'idle';
    if (!(this.settings.jog in JOGS)) this.settings.jog = 'jog1';
    this.animButton.textContent = `${ANIM_LABELS[this.settings.anim]} [A]`;
    // Animation only applies to the character subject.
    this.animButton.hidden = !open || subject.name !== 'Character';
    this.scrubBar.hidden = this.animButton.hidden;
    this.freezeButton.classList.toggle('on', this.settings.frozen);
    if (typeof this.settings.scrub !== 'number') this.settings.scrub = 0;

    this.controls.enabled = open;
    this.applyOverlays();

    for (const [key, btn] of this.buttons) {
      btn.classList.toggle('on', this.settings[key]);
      if (key !== 'open') btn.hidden = !open;
    }
    this.onToggle(open);
  }

  private buildUI(): void {
    const bar = document.createElement('div');
    bar.id = 'toolbar';
    const add = (key: Toggle, label: string) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => this.toggle(key));
      bar.append(b);
      this.buttons.set(key, b);
    };
    add('open', 'Inspect [I]');
    add('edges', 'Edges [E]');
    add('wireframe', 'Wireframe [G]');
    this.subjectButton.addEventListener('click', () => this.nextSubject());
    bar.append(this.subjectButton);
    this.animButton.addEventListener('click', () => this.nextAnim());
    bar.append(this.animButton);

    // Scrubber: Freeze toggle + 0–1 slider. Dragging the slider freezes.
    this.scrubBar.id = 'scrubber';
    this.freezeButton.textContent = 'Freeze [F]';
    this.freezeButton.addEventListener('click', () => this.toggleFreeze());
    Object.assign(this.slider, { type: 'range', min: '0', max: '1', step: '0.001', value: '0' });
    this.slider.addEventListener('input', () => {
      this.settings.scrub = Number(this.slider.value);
      if (!this.settings.frozen) {
        this.settings.frozen = true;
        this.apply();
      }
      this.save();
    });
    this.readout.className = 'readout';
    this.scrubBar.append(this.freezeButton, this.slider, this.readout);
    document.body.append(this.scrubBar);
    document.body.append(bar);
  }

  // Persist so the view survives the frequent reloads while iterating.
  private load(): void {
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
    } catch {
      /* storage unavailable: keep defaults */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }
}
