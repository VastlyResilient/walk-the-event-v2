import * as THREE from 'three';
import type { Floor } from '../core/data';
import { guideUniforms } from '../guide/materials';
import type { FrameSource } from './frames';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uView;      // u0, v0, su, sv (displayed region of the image, image coords: v down)
uniform vec2 uLook;      // -1..1 look-around
uniform vec2 uLookK;     // uniform shift, depth-scaled shift
uniform float uColW;     // colour panel width as a fraction of the packed texture
uniform vec2 uTexel;     // one texel of the packed texture
uniform float uSharp;    // 0..1 sharpening strength
uniform vec3 uDolly;     // centre u, centre v, amount (0..1)
uniform float uFade;
uniform float uSweep;    // 0..1 pink light sweep progress
uniform float uExposure;  // >1 only in the pitch-dark passage
uniform vec2 uCol;       // footage column in screen uv (x0, x1); outside it we paint an ambient extension
float depthAt(vec2 img) {
  vec2 t = vec2(uColW + img.x * (1.0 - uColW), 1.0 - img.y * 0.5);
  return texture2D(uTex, t).r;
}
void main() {
  float cu = (vUv.x - uCol.x) / (uCol.y - uCol.x);
  if (cu < 0.0 || cu > 1.0) {
    // ambient side panels: the frame's own colour at this height, averaged across the row (no streaks)
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 9; i++) {
      for (int j = 0; j < 5; j++) {
        vec2 sp = vec2((float(i) + 0.5) / 9.0, clamp(1.0 - vUv.y + (float(j) - 2.0) * 0.09, 0.01, 0.99));
        vec2 ip = uView.xy + sp * uView.zw;
        acc += texture2D(uTex, vec2(ip.x * uColW, 1.0 - ip.y)).rgb;
      }
    }
    acc /= 5.0;
    float dist = cu < 0.0 ? -cu : cu - 1.0;
    float fall = exp(-dist * 2.6);
    gl_FragColor = vec4(acc / 9.0 * (0.2 + 0.32 * fall) * uFade, 1.0);
    return;
  }
  vec2 img = uView.xy + vec2(cu, 1.0 - vUv.y) * uView.zw;
  // Dolly push with depth parallax (fallback station transition)
  if (uDolly.z > 0.0) {
    float d = depthAt(img);
    vec2 c = uDolly.xy;
    img = c + (img - c) / (1.0 + uDolly.z * (0.9 + 1.4 * d));
  }
  // Look-around: two-step depth-aware shift (nearer pixels move more = parallax)
  float d0 = depthAt(img);
  vec2 shift = uLook * vec2(1.0, 0.6) * (uLookK.x + uLookK.y * d0);
  float d1 = depthAt(img - shift);
  shift = uLook * vec2(1.0, 0.6) * (uLookK.x + uLookK.y * d1);
  img = clamp(img - shift, vec2(0.001), vec2(0.999));
  vec2 tc = vec2(img.x * uColW, 1.0 - img.y);
  vec3 col = texture2D(uTex, tc).rgb;
  // contrast-adaptive sharpening (after AMD FidelityFX CAS): sharpen more where local contrast is low, less where it
  // is already high, so detail pops without halos
  if (uSharp > 0.0) {
    vec3 na = texture2D(uTex, tc + vec2(0.0, uTexel.y)).rgb, nb = texture2D(uTex, tc - vec2(0.0, uTexel.y)).rgb;
    vec3 nc = texture2D(uTex, tc + vec2(uTexel.x, 0.0)).rgb, nd = texture2D(uTex, tc - vec2(uTexel.x, 0.0)).rgb;
    vec3 mn = min(col, min(min(na, nb), min(nc, nd))), mx = max(col, max(max(na, nb), max(nc, nd)));
    vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
    vec3 w = amp * (-1.0 / mix(8.0, 5.0, uSharp));
    col = clamp((col + (na + nb + nc + nd) * w) / (1.0 + 4.0 * w), 0.0, 1.0);
  }
  if (uSweep > 0.0 && uSweep < 1.0) {
    float band = exp(-pow((vUv.x + vUv.y * 0.35 - uSweep * 1.8 + 0.2) * 11.0, 2.0));
    col += vec3(1.0, 0.25, 0.7) * band * 0.22 * sin(uSweep * 3.14159);
  }
  col = 1.0 - pow(1.0 - clamp(col, 0.0, 1.0), vec3(uExposure)); // highlight-safe lift
  // feather the footage column's edge into the ambient panels (wide screens only)
  if (uCol.x > 0.0) { float e = min(cu, 1.0 - cu) * (uCol.y - uCol.x); col *= mix(0.55, 1.0, smoothstep(0.0, 0.018, e)); }
  gl_FragColor = vec4(col * uFade, 1.0);
}`;

export class WalkView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  private bgScene = new THREE.Scene();
  private bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bgMat: THREE.ShaderMaterial;
  tex: THREE.Texture | null = null;
  floor: Floor | null = null;
  source: FrameSource | null = null;
  look = new THREE.Vector2();
  lookK = new THREE.Vector2(0.022, 0.03);
  view = new THREE.Vector4(0, 0, 1, 1);
  overscan = 1.075;
  frame = 0;
  depthFit = new THREE.Vector2();
  dolly = new THREE.Vector3(0.5, 0.5, 0);
  private q0 = new THREE.Quaternion();
  private q1 = new THREE.Quaternion();
  private p0 = new THREE.Vector3();
  private p1 = new THREE.Vector3();
  /** Room light on the guide: driven from the footage around her (see App.lightFromRoom). */
  hemi = new THREE.HemisphereLight(0xffffff, 0x8070a0, 1.7);
  key = new THREE.DirectionalLight(0xffffff, 1.5);
  width = 1; // footage column width (CSS px)
  height = 1;
  offsetX = 0; // footage column left edge (CSS px)
  contain = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.maxDpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    // phones drop the WebGL context under memory pressure (iOS often after switching apps): the restored context comes
    // back without her model, textures and shaders, so reload the page instead of carrying on without her
    const cv = this.renderer.domElement;
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);
    cv.addEventListener('webglcontextrestored', () => { location.reload(); }, false);
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTex: { value: null }, uView: { value: this.view }, uLook: { value: this.look }, uLookK: { value: this.lookK },
        uColW: { value: 2 / 3 }, uTexel: { value: new THREE.Vector2(1 / 1080, 1 / 1280) }, uSharp: { value: 0.65 }, uDolly: { value: this.dolly }, uFade: { value: 1 }, uSweep: { value: 0 }, uCol: { value: new THREE.Vector2(0, 1) }, uExposure: { value: 1 },
      },
    });
    this.bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat));
    // Lighting for the toon guide: soft key from camera-left, fill from the room.
    const hemi = this.hemi;
    this.scene.add(hemi);
    const key = this.key;
    // the key light lives in the world: App.lightFromRoom aims it from the brightest light around her in the footage
    key.position.set(-1, 3, 2);
    this.scene.add(key);
    this.scene.add(key.target);
    this.scene.add(this.camera);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  set fade(v: number) { this.bgMat.uniforms.uFade.value = v; }
  set sweep(v: number) { this.bgMat.uniforms.uSweep.value = v; }
  set exposure(v: number) { this.bgMat.uniforms.uExposure.value = v; }
  get bgExposure(): number { return this.bgMat.uniforms.uExposure.value; }

  /** Phones render at <=1.6x (the footage itself is 720 px wide); adapt() lowers it further if frames run long. */
  maxDpr = 2; // phones too (adapt() steps down if a phone can't keep up)
  private slowT = 0;
  private fastT = 0;
  private lastDrop = -1e9;
  adapt(dt: number) {
    const r = this.renderer.getPixelRatio(), now = performance.now();
    if (dt > 0.024) { this.slowT += dt; this.fastT = 0; } else { this.fastT += dt; this.slowT = Math.max(0, this.slowT - dt * 0.5); }
    if (this.slowT > 1.2 && r > 1.01) { this.slowT = 0; this.lastDrop = now; this.setDpr(Math.max(1, r - 0.25)); }
    // only step back up after a long calm stretch, and never within 30 s of a drop (no see-sawing on GPU-bound phones)
    else if (this.fastT > 10 && now - this.lastDrop > 30000 && r < Math.min(devicePixelRatio, this.maxDpr) - 0.01) { this.fastT = 0; this.setDpr(Math.min(devicePixelRatio, this.maxDpr, r + 0.2)); }
  }
  private setDpr(r: number) { this.renderer.setPixelRatio(r); this.resize(); }

  /** After the first real decoder frame goes straight to WebGL, make sure it worked; if not, use the canvas path. */
  private checkUpload = false;
  private uploadChecked = false;
  private verifyDirectUpload() {
    this.checkUpload = false;
    this.uploadChecked = true;
    const gl = this.renderer.getContext();
    if (gl.getError() === gl.NO_ERROR || !this.source || !this.floor) return;
    console.warn('direct VideoFrame upload failed; using the canvas path');
    const src = this.source;
    src.useCanvas();
    this.setSource(this.floor, src);
  }

  /** Upload the frame on screen: a VideoFrame goes straight to the GPU, the <video> fallback via its canvas. */
  private uploaded: VideoFrame | null = null;
  syncTexture() {
    const s = this.source;
    if (!s || !s.direct || !s.frame || s.frame === this.uploaded || !this.tex || !s.frame.codedWidth) return; // codedWidth 0 = closed
    // a plain Texture (not VideoFrameTexture): keeps sRGB8 hardware decode like the canvas path, and storage is allocated once
    this.tex.image = s.frame;
    this.tex.needsUpdate = true;
    this.uploaded = s.frame;
    this.checkUpload = !this.uploadChecked;
  }

  setSource(floor: Floor, source: FrameSource) {
    this.floor = floor;
    this.source = source;
    this.tex?.dispose();
    this.uploaded = null;
    this.tex = source.direct ? new THREE.Texture() : new THREE.CanvasTexture(source.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.bgMat.uniforms.uTex.value = this.tex;
    const tierInfo = source.meta.tiers[source.tier];
    if (tierInfo) this.bgMat.uniforms.uTexel.value.set(1 / tierInfo.packed_w, 1 / tierInfo.h);
    guideUniforms.uDepthTex.value = this.tex;
    source.onDrawn = () => { if (this.tex && !source.direct) this.tex.needsUpdate = true; };
    source.onModeChange = () => { if (this.source === source && this.floor) this.setSource(this.floor, source); };
    this.resize();
  }

  resize() {
    const W = innerWidth, H = innerHeight;
    this.renderer.setSize(W, H);
    // Phones: cover-fit the 9:16 footage. Wide screens: show the whole frame as a centred column
    // (cover-cropping a portrait video on a landscape screen would throw away two thirds of it).
    const va = 9 / 16;
    const sa = W / H;
    this.contain = sa > 0.72;
    this.width = this.contain ? Math.round(H * va) : W;
    this.height = H;
    this.offsetX = this.contain ? Math.round((W - this.width) / 2) : 0;
    this.bgMat.uniforms.uCol.value.set(this.offsetX / W, (this.offsetX + this.width) / W);
    let su = 1, sv = 1;
    if (!this.contain) { if (sa > va) sv = va / sa; else su = sa / va; }
    su /= this.overscan;
    sv /= this.overscan;
    this.view.set(0.5 - su / 2, 0.5 - sv / 2, su, sv);
    const dpr = this.renderer.getPixelRatio();
    guideUniforms.uViewport.value.set(this.width * dpr, H * dpr);
    guideUniforms.uViewOffset.value.set(this.offsetX * dpr, 0);
    guideUniforms.uOutlinePx.value = 1.6 * dpr;
  }

  /** Update the camera to (fractional) frame f. */
  setFrame(f: number) {
    const cam = this.floor!.cam;
    const n = cam.frames;
    f = Math.max(0, Math.min(n - 1, f));
    this.frame = f;
    const i = Math.floor(f), j = Math.min(n - 1, i + 1), t = f - i;
    this.p0.fromArray(cam.pos, i * 3);
    this.p1.fromArray(cam.pos, j * 3);
    this.q0.fromArray(cam.quat, i * 4);
    this.q1.fromArray(cam.quat, j * 4);
    this.camera.position.lerpVectors(this.p0, this.p1, t);
    this.camera.quaternion.slerpQuaternions(this.q0, this.q1, t);
    this.camera.updateMatrixWorld(true);
    const a = cam.depth_a[i] ?? 1, b = cam.depth_b[i] ?? 0.1;
    this.depthFit.set(a, b);
    // rim/tint from the footage colour around her
    const ac = this.floor!.meta.avg_colors_every_15;
    const c = ac[Math.min(ac.length - 1, Math.floor(f / 15))];
    if (c) {
      const col = new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
      const hsl = { h: 0, s: 0, l: 0 };
      col.getHSL(hsl);
      guideUniforms.uRim.value.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.2), 0.62);
      // Keep her readable as an illustrated character: tint only gently toward the room light.
      const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
      // Sit her in the room's light: darker, more tinted in dim spaces; crisp ink stays readable.
      const exposure = 0.62 + 0.5 * Math.min(1, lum / 0.45);
      guideUniforms.uTint.value.setRGB(1, 1, 1).lerp(new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s), 0.72), 0.22 + 0.3 * (1 - Math.min(1, lum / 0.45))).multiplyScalar(exposure);
      guideUniforms.uRimStrength.value = 0.4 + 0.35 * (1 - lum);
    }
  }

  /** Displayed region including look-around shift for an element at relative disparity d. */
  regionFor(d: number) {
    const sx = this.look.x * (this.lookK.x + this.lookK.y * d);
    const sy = this.look.y * 0.6 * (this.lookK.x + this.lookK.y * d);
    return { u0: this.view.x - sx, v0: this.view.y - sy, su: this.view.z, sv: this.view.w };
  }

  updateProjection(guideDisparity: number) {
    const I = this.floor!.cam.intrinsics;
    const { u0, v0, su, sv } = this.regionFor(guideDisparity);
    const n = 0.05, fa = 200;
    const m = this.camera.projectionMatrix;
    // x_ndc = 2(u_img-u0)/su - 1 with u_img = cx + fx * X/(-Z); y_ndc = 1 - 2(v_img - v0)/sv with v_img = cy - fy * Y/(-Z)
    m.set(
      (2 * I.fx) / su, 0, 1 - (2 * (I.cx - u0)) / su, 0,
      0, (2 * I.fy) / sv, (2 * (I.cy - v0)) / sv - 1, 0,
      0, 0, -(fa + n) / (fa - n), (-2 * fa * n) / (fa - n),
      0, 0, -1, 0,
    );
    this.camera.projectionMatrixInverse.copy(m).invert();
    // Occlusion lookup: screen uv -> depth panel uv (packed texture, flipY'd canvas)
    const cw = 2 / 3;
    guideUniforms.uDepthRect.value.set(cw + u0 * (1 - cw), 1 - (v0 + sv) / 2, su * (1 - cw), sv / 2);
    guideUniforms.uDepthFit.value.copy(this.occlusionFit(guideDisparity));
    this.occFit.copy(guideUniforms.uDepthFit.value);
  }

  /**
   * Optional per-frame depth fit re-calibrated to the floor (nav map `da`/`db`, set by the guide brain). The solve's own
   * fit was made on far feature points and reads near geometry up to 0.3-0.6x short on upstairs stretches.
   */
  fitAt: ((frame: number) => number[] | null) | null = null;
  /** The fit the guide's occlusion shader uses this frame (1/z = x * d_linear + y), for QA tools. */
  occFit = new THREE.Vector2();
  private occTmp = new THREE.Vector2();
  /**
   * The occlusion shader reads the depth byte from the sRGB footage texture, i.e. LINEARISED, while every fit is on the
   * raw byte. Re-express the (floor-recalibrated) fit in linear-d space, exact at the guide's own depth (where the
   * "is the scene in front of her?" decision is made): tangent of the sRGB curve at her disparity.
   */
  private occlusionFit(guideDisparity: number) {
    const a0 = this.depthFit.x, b0 = this.depthFit.y;
    if (!(a0 > 0)) return this.occTmp.set(0, 0);
    const zh = 1 / Math.max(0.02, a0 * guideDisparity + b0); // her distance (the disparity was made from the same fit)
    const fit = this.fitAt?.(Math.round(this.frame));
    // where the depth can't be trusted at all (far from any frame the floor calibration converged on: the end of
    // upstairs, looking down into the atrium), no occlusion: a wrong cut-out is worse than none
    if (fit && fit[2] === 0) return this.occTmp.set(0, 0);
    const a = fit ? fit[0] : a0, b = fit ? fit[1] : b0;
    if (!(a > 0)) return this.occTmp.set(0, 0);
    const d0 = Math.max(0.05, Math.min(0.98, (1 / zh - b) / a));
    const L0 = d0 <= 0.04045 ? d0 / 12.92 : Math.pow((d0 + 0.055) / 1.055, 2.4);
    const dL = d0 <= 0.04045 ? 1 / 12.92 : (2.4 / 1.055) * Math.pow((d0 + 0.055) / 1.055, 1.4);
    return this.occTmp.set(a / dL, b + a * (d0 - L0 / dL));
  }

  /** Image coords (0..1, v down) -> CSS pixels, with parallax for disparity d. */
  imageToScreen(u: number, v: number, d = 0.5) {
    const { u0, v0, su, sv } = this.regionFor(d);
    let x = u, y = v;
    if (this.dolly.z > 0) {
      const k = 1 + this.dolly.z * (0.9 + 1.4 * d);
      x = this.dolly.x + (x - this.dolly.x) * k;
      y = this.dolly.y + (y - this.dolly.y) * k;
    }
    return [this.offsetX + ((x - u0) / su) * this.width, ((y - v0) / sv) * this.height];
  }

  /** World point -> CSS pixels (+ depth in metres); null when behind the camera. */
  project(p: THREE.Vector3) {
    const v = p.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -0.1) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    return { x: this.offsetX + (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, z: -p.clone().applyMatrix4(this.camera.matrixWorldInverse).z };
  }

  /** Relative disparity (0..1) that corresponds to metric depth z under the current fit. */
  disparityForDepth(z: number) {
    const { x: a, y: b } = this.depthFit;
    return a > 0 ? Math.max(0, Math.min(1, (1 / z - b) / a)) : 0.3;
  }

  render() {
    this.syncTexture();
    this.renderer.clear();
    this.renderer.render(this.bgScene, this.bgCam);
    this.renderer.clearDepth();
    if (this.contain) {
      this.renderer.setViewport(this.offsetX, 0, this.width, this.height);
      this.renderer.setScissor(this.offsetX, 0, this.width, this.height);
      this.renderer.setScissorTest(true);
    }
    this.renderer.render(this.scene, this.camera);
    if (this.checkUpload) this.verifyDirectUpload();
    if (this.contain) {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, innerWidth, innerHeight);
    }
  }
}
