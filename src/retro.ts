import * as THREE from 'three';

/** Low-res mode tuning. */
export const RETRO = {
  /** Vertical resolution of the frame. Width follows from the aspect (240 → 320). */
  height: 240,
  aspect: 4 / 3,
  /** World units visible top to bottom at zoom 1. */
  viewHeight: 11.5,
  /** Scale the frame up by whole numbers only, so every pixel is the same size. */
  integerScale: true,
  /** Colour around the frame. */
  border: '#000',
};

/**
 * Orthographic camera rendered into a tiny target, then scaled up with
 * nearest-neighbour filtering. The camera snaps to the pixel grid so the
 * scenery doesn't shimmer as it moves; the leftover sub-pixel offset is
 * applied when scaling up, so the camera still glides smoothly.
 */
export class LowRes {
  readonly camera = new THREE.OrthographicCamera();
  readonly width = Math.round(RETRO.height * RETRO.aspect);
  readonly height = RETRO.height;
  private target: THREE.WebGLRenderTarget;
  private blit: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private blitScene = new THREE.Scene();
  private blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor() {
    // One spare pixel on every side to cover the sub-pixel shift.
    this.target = new THREE.WebGLRenderTarget(this.width + 2, this.height + 2, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.blit = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this.target.texture },
          offset: { value: new THREE.Vector2() },
          inner: { value: new THREE.Vector2(this.width, this.height) },
          full: { value: new THREE.Vector2(this.width + 2, this.height + 2) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform vec2 offset, inner, full;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(map, (vUv * inner + 1.0 + offset) / full);
            #include <colorspace_fragment>
          }`,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.blitScene.add(this.blit);
  }

  /** Aim the camera at `target` from `offset`, snapped to the pixel grid. */
  aim(target: THREE.Vector3, offset: THREE.Vector3, zoom: number): void {
    const cam = this.camera;
    const texel = (RETRO.viewHeight * zoom) / this.height;
    cam.left = (-texel * (this.width + 2)) / 2;
    cam.right = -cam.left;
    cam.top = (texel * (this.height + 2)) / 2;
    cam.bottom = -cam.top;
    cam.near = 0.1;
    cam.far = 200;
    cam.updateProjectionMatrix();

    // Orientation first (it never changes, only the position does).
    cam.position.copy(offset);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    this.up.setFromMatrixColumn(cam.matrixWorld, 1);

    // Snap the target to whole pixels on screen; keep the remainder for the blit.
    const r = target.dot(this.right) / texel;
    const u = target.dot(this.up) / texel;
    const dr = r - Math.round(r);
    const du = u - Math.round(u);
    this.blit.material.uniforms.offset.value.set(dr, du);
    cam.position
      .copy(target)
      .addScaledVector(this.right, -dr * texel)
      .addScaledVector(this.up, -du * texel)
      .addScaledVector(offset, zoom);
    cam.updateMatrixWorld();
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(null);
    renderer.render(this.blitScene, this.blitCamera);
  }

  /**
   * Where the frame goes in the window: the biggest 4:3 box that fits, at a
   * whole-number scale in device pixels. Sizes in CSS pixels.
   */
  frame(): { left: number; top: number; width: number; height: number; device: [number, number] } {
    const dpr = window.devicePixelRatio || 1;
    const availW = window.innerWidth * dpr;
    const availH = window.innerHeight * dpr;
    let scale = Math.min(availW / this.width, availH / this.height);
    if (RETRO.integerScale && scale >= 1) scale = Math.floor(scale);
    const w = Math.round(this.width * scale);
    const h = Math.round(this.height * scale);
    return {
      left: (availW - w) / 2 / dpr,
      top: (availH - h) / 2 / dpr,
      width: w / dpr,
      height: h / dpr,
      device: [w, h],
    };
  }
}
