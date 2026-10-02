import * as THREE from 'three';

/** Tracks keyboard state and left-click attacks (with the ground point clicked). */
export class Input {
  readonly keys = new Set<string>();
  /** Ground point of the last left-click attack, consumed by the player controller. */
  attackTarget: THREE.Vector3 | null = null;
  zoom = 1;
  /** When false, all game input is ignored (e.g. while the inspector is open). */
  enabled = true;

  private pointer = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();

  constructor(
    private canvas: HTMLCanvasElement,
    /** Camera used to pick the clicked ground point; swapped with the view. */
    public camera: THREE.Camera,
    private ground: THREE.Object3D,
  ) {
    window.addEventListener('keydown', (e) => this.enabled && this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.enabled) return;
      this.setPointer(e);
      this.attackTarget = this.pick();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.001), 0.5, 2);
      },
      { passive: false },
    );
  }

  /** Drop any held keys/clicks, e.g. when switching views. */
  reset(): void {
    this.keys.clear();
    this.attackTarget = null;
  }

  /** Ground point under the pointer (or null if it misses the ground). */
  private pick(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.ground)[0];
    return hit ? hit.point.setY(0) : null;
  }

  /** WASD as a 2D vector in screen space (x right, y up). */
  axis(): THREE.Vector2 {
    const v = new THREE.Vector2(
      (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
      (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
    );
    return v.lengthSq() > 0 ? v.normalize() : v;
  }

  get running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  private setPointer(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
}
