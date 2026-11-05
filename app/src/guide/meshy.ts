import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AnimInput, Gesture } from './anim';
import { guideUniforms } from './materials';

/**
 * The Hermes guide (v3): regenerated from Bobby's sculpt in an A-pose (Meshy image-to-3D), auto-rigged by Meshy and
 * driven by Meshy mocap clips (idle / walk / run / turn-in-place steps / waves / presenting / dances). Arms are free of
 * the body in the bind pose, so clips play fully; procedural layers aim the presenting hand at the work, hold the skirt
 * and lift the knees on stairs, rest a hand on rails and turn the head. Hair and skirt get GPU secondary motion.
 */
export interface MeshyRig {
  root: THREE.Group;
  headCenter: THREE.Object3D;
  contact: THREE.Mesh;
  pool: THREE.Mesh;
  bones: Record<string, THREE.Bone>;
  /** Per-shoe contact shadows, and their strength (set by the room lighting). */
  feet: THREE.Mesh[];
  ground: { ao: number };
}

const flowUniforms = {
  uFlowVel: { value: new THREE.Vector3() }, // her velocity in model space (m/s)
  uFlowT: { value: 0 },
  uFlowPhase: { value: 0 },
  uFlowY0: { value: 0 },
  uFlowH: { value: 1.6 },
  uHairMap: { value: null as THREE.Texture | null },
  uSkirtLift: { value: 0 }, // 0..1: hands lifting the front of the skirt (stairs)
};

function softDisc(rgba: [number, number, number, number][], stops: number[]) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
  stops.forEach((s, i) => g.addColorStop(s, `rgba(${rgba[i].join(',')})`));
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Her floor shadows are hidden by whatever the footage has in front of them, with the same depth test as her body: a
 * guest walking between us and her used to get the dark blob painted over their legs.
 */
function occludeShadow(mat: THREE.MeshBasicMaterial) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, guideUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGuideViewZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGuideViewZ = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vGuideViewZ;
        uniform sampler2D uDepthTex; uniform vec4 uDepthRect; uniform vec2 uDepthFit; uniform vec2 uViewport; uniform vec2 uViewOffset;`)
      .replace('void main() {', `void main() {
        if (uDepthFit.x > 0.0) {
          vec2 duv = uDepthRect.xy + (gl_FragCoord.xy - uViewOffset) / uViewport * uDepthRect.zw;
          float d = texture2D(uDepthTex, duv).r;
          float maskv = texture2D(uDepthTex, vec2(duv.x, duv.y - 0.5)).r;
          float sceneZ = 1.0 / max(uDepthFit.x * d + uDepthFit.y, 0.02);
          if (vGuideViewZ - sceneZ > mix(0.9, 0.3, smoothstep(0.35, 0.65, maskv))) discard;
        }`);
  };
  mat.customProgramCacheKey = () => 'guideShadow';
}

/**
 * Contact occlusion under each shoe: a small dense shadow that is there while the foot is down and fades as it lifts
 * (the big soft blob alone read as a disc she floats over). Placed at render time from the foot bones, so it never
 * lags the animation by a frame; `ground.ao` (set by the room lighting) scales it with how diffuse the light is.
 */
function footShadows(root: THREE.Group, bones: Record<string, THREE.Bone>, ground: { ao: number }) {
  const tex = softDisc([[0, 0, 0, 0.95], [0, 0, 0, 0.6], [0, 0, 0, 0]], [0, 0.4, 1]);
  const v = new THREE.Vector3(), t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  // resting heights of the ankle and the ball of the foot above her floor, learnt as running minimums (they relax
  // upward slowly, so a stretch of stairs or a jump can't leave them wrong); a foot is down while either is near rest
  // (heel strike: the ankle; toe-off: the ball of the foot)
  const rest = { ankle: Infinity, toe: Infinity, t: 0 };
  const out: THREE.Mesh[] = [];
  for (const side of ['Left', 'Right']) {
    const foot = bones[`${side}Foot`], toe = bones[`${side}ToeBase`];
    if (!foot) continue;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
    occludeShadow(mat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.3), mat);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.onBeforeRender = () => {
      // (the scene's matrices are current here; the renderer reads matrixWorld only after this callback)
      v.setFromMatrixPosition(foot.matrixWorld);
      if (toe) t.setFromMatrixPosition(toe.matrixWorld); else t.copy(v);
      const fy = root.position.y, ah = v.y - fy, th = t.y - fy;
      const now = performance.now(), rdt = Math.min(0.1, (now - rest.t) / 1000);
      if (rdt > 0.001) { rest.t = now; rest.ankle += 0.04 * rdt; rest.toe += 0.04 * rdt; } // (once per frame, shared by both feet)
      // (floored: a foot on a lower stair step must not teach a rest height below the sculpt's own, ~0.10 / ~0.02 m)
      rest.ankle = Math.max(0.07, Math.min(rest.ankle, ah)); rest.toe = Math.max(0.005, Math.min(rest.toe, th));
      const lift = Math.max(0, Math.min(ah - rest.ankle, toe ? th - rest.toe : 1));
      const down = 1 - THREE.MathUtils.smoothstep(lift, 0.01, 0.09);
      mat.opacity = ground.ao * down * guideUniforms.uOpacity.value;
      const dx = t.x - v.x, dz = t.z - v.z;
      const yaw = Math.hypot(dx, dz) > 1e-4 ? Math.atan2(dx, dz) : root.rotation.y;
      q.setFromEuler(e.set(-Math.PI / 2, yaw, 0, 'YXZ')); // flat on the floor, long side along the foot
      s.setScalar(0.85 + 0.3 * down);
      m.matrixWorld.compose(v.set(v.x + dx * 0.45, fy + 0.006, v.z + dz * 0.45), q, s);
    };
    root.add(m);
    out.push(m);
  }
  return out;
}

function patchMaterial(mat: THREE.MeshStandardMaterial) {
  mat.transparent = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, guideUniforms, flowUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying float vGuideViewZ; varying float vHair; varying vec3 vMPos;
        uniform vec3 uFlowVel; uniform float uFlowT; uniform float uFlowPhase; uniform float uFlowY0; uniform float uFlowH; uniform float uSkirtLift;
        uniform sampler2D uHairMap;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        {
          // secondary motion, in model space after skinning
          float frac = (position.y - uFlowY0) / uFlowH;
          vec3 base = texture2D(uHairMap, uv).rgb;
          float dark = 1.0 - smoothstep(0.12, 0.3, dot(base, vec3(0.333)));
          float speed = length(uFlowVel.xz);
          vec3 lag = -uFlowVel * 0.032;
          // hair: dark texels above the neck, the flipped ends (lower hair) move most
          float hair = dark * smoothstep(0.76, 0.81, frac) * (0.35 + 0.65 * smoothstep(0.97, 0.82, frac));
          // keep the face still: eyes and brows are dark too
          float face = step(0.015 * uFlowH, position.z) * step(abs(position.x), 0.05 * uFlowH) * step(frac, 0.935) * step(0.8, frac);
          hair *= 1.0 - face;
          vHair = hair; vMPos = (position - vec3(0.0, uFlowY0, 0.0)) / uFlowH;
          vec3 sway = vec3(sin(uFlowT * 5.3 + position.y * 18.0), 0.0, cos(uFlowT * 4.1 + position.x * 25.0)) * 0.004;
          transformed += hair * (lag * 0.8 + sway * (0.6 + speed) + vec3(0.0, -abs(sin(uFlowPhase * 6.2832)) * 0.006 * speed, 0.0));
          // skirt: light texels between the waist and the hem, more toward the hem
          float skirt = (1.0 - dark) * smoothstep(0.6, 0.32, frac) * smoothstep(0.2, 0.27, frac);
          vec2 radial = normalize(position.xz + vec2(1e-4));
          float ang = atan(position.z, position.x);
          float swirl = sin(uFlowPhase * 6.2832 * 2.0 + ang * 3.0) * 0.5 + 0.5;
          transformed.xz += skirt * skirt * (lag.xz * 1.5 + radial * (0.008 + 0.014 * swirl) * min(speed, 3.0) + radial * 0.003 * sin(uFlowT * 3.0 + ang * 5.0));
          transformed.y += skirt * skirt * 0.012 * min(speed, 3.0) * swirl;
          // stairs: her hands gather the skirt at the sides, so the front of the hem rises clear of her feet
          float front = smoothstep(-0.02 * uFlowH, 0.06 * uFlowH, position.z);
          float lowSkirt = (1.0 - dark) * smoothstep(0.5, 0.3, frac) * smoothstep(0.16, 0.24, frac);
          transformed.y += uSkirtLift * lowSkirt * (0.25 + 0.75 * front) * 0.065 * uFlowH * smoothstep(0.5, 0.24, frac);
        }`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGuideViewZ = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vGuideViewZ;
        uniform vec3 uRim; uniform float uRimStrength; uniform vec3 uTint; uniform float uOpacity;
        uniform vec3 uBandLo; uniform vec3 uBandMid; uniform vec3 uBandHi; uniform float uShine;
        uniform vec3 uKeyDir; uniform float uKeyK; uniform float uHairLit;
        varying float vHair; varying vec3 vMPos;
        uniform sampler2D uDepthTex; uniform vec4 uDepthRect; uniform vec2 uDepthFit; uniform vec2 uViewport; uniform vec2 uViewOffset;`)
      .replace('void main() {', `void main() {
        if (uDepthFit.x > 0.0) {
          vec2 suv = (gl_FragCoord.xy - uViewOffset) / uViewport;
          vec2 duv = uDepthRect.xy + suv * uDepthRect.zw;
          float d = texture2D(uDepthTex, duv).r;
          float maskv = texture2D(uDepthTex, vec2(duv.x, duv.y - 0.5)).r;
          float sceneZ = 1.0 / max(uDepthFit.x * d + uDepthFit.y, 0.02);
          // a person nearer than her by > 0.3 m hides her (was 0.5: she read as standing in front of people who were
          // nearer); scenery needs 0.9 m (mono depth is noisier on walls and floors)
          float need = mix(0.9, 0.3, smoothstep(0.35, 0.65, maskv));
          // a hard cut: a soft alpha band here left whole stretches of her see-through when a walker passed at about
          // her depth (the soft mask edge swings need across the band)
          if (vGuideViewZ - sceneZ > need) discard;
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // (round 2, tester: "from behind in the blue and violet rooms the highlight reads as wide grey stripes") the
          // hair's broad specular takes the room's hue and softens with its saturation (neutral rooms unchanged)
          float hlS = vHair * uHairLit;
          vec3 hT = uTint / max(max(uTint.r, uTint.g), max(uTint.b, 1e-3));
          float sat = 1.0 - min(min(hT.r, hT.g), hT.b);
          float kS = smoothstep(0.13, 0.19, sat); // deep coloured light only (the warm and white rooms stay as they are)
          vec3 sTint = mix(vec3(1.0), hT * hT, kS) * (1.0 - 0.55 * kS);
          reflectedLight.directSpecular *= mix(vec3(1.0), sTint, hlS);
          reflectedLight.indirectSpecular *= mix(vec3(1.0), sTint, hlS);
        }`)
      .replace('#include <opaque_fragment>', `outgoingLight *= mix(vec3(1.0), uTint, 0.7);
        // the room's light along her height (bind-pose height 0 = soles, 1 = crown): floor light on her legs, the
        // fixtures above on her hair and shoulders
        outgoingLight *= vMPos.y < 0.5 ? mix(uBandLo, uBandMid, smoothstep(0.08, 0.5, vMPos.y)) : mix(uBandMid, uBandHi, smoothstep(0.5, 0.92, vMPos.y));
        float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.4);
        outgoingLight += uRim * rim * uRimStrength * 0.8;
        {
          // (owner: "have her hair adapt with the shadows and lighting") her hair is dark, so the body's light along her
          // height barely showed on it. Relative to neutral light (bands 1, a white room) the hair takes a stronger
          // share of the light above her head: darker in shadow, brighter under a spot, and the room's colour (uTint's
          // hue, doubled). In neutral light every term below is 1 / unchanged.
          float hl = vHair * uHairLit;
          // (the hue at the tint's own brightness: a coloured room shifts her hair's colour, only shadow darkens it)
          vec3 hue = uTint / max(dot(uTint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
          vec3 hairMul = max(vec3(0.35), vec3(1.0) + (uBandHi - vec3(1.0)) * 0.9 + (hue - vec3(1.0)) * 1.0);
          outgoingLight *= mix(vec3(1.0), hairMul, hl);
          // glossy anime hair: a soft highlight ring where the hair turns toward the light, broken into strands, in the
          // room's light colour (uTint follows the footage; it dims in the dark rooms). In diffuse light the ring sits
          // where the hair turns up (view up, as before); under a fixture that stands out it moves toward that light
          // (kept from below the horizon: light comes from above)
          vec3 Lv = (viewMatrix * vec4(uKeyDir.x, max(uKeyDir.y, 0.35), uKeyDir.z, 0.0)).xyz;
          vec3 Lr = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(Lv), clamp(uKeyK * 0.8 * uHairLit, 0.0, 0.8)));
          float ny = dot(normalize(normal), Lr);
          float ring = smoothstep(0.02, 0.3, ny) * (1.0 - smoothstep(0.5, 0.8, ny));
          float strand = smoothstep(0.25, 0.95, 0.5 + 0.5 * sin(vMPos.x * 210.0 + sin(vMPos.z * 70.0 + vMPos.y * 40.0) * 2.4));
          vec3 shineCol = mix(uTint, max(vec3(0.0), vec3(1.0) + (hue - vec3(1.0)) * 2.5), uHairLit);
          outgoingLight += shineCol * uBandHi * vHair * ring * (0.2 + 0.8 * strand) * 0.2 * uShine;
        }
        #include <opaque_fragment>`)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= uOpacity;');
  };
  mat.customProgramCacheKey = () => 'meshyGuide';
}

export async function loadMeshyRig(url: string): Promise<{ rig: MeshyRig; anim: MeshyAnimator }> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const g = await loader.loadAsync(url);
  const model = g.scene;
  const root = new THREE.Group();
  root.name = 'HermesGuideMeshy';
  // normalise: feet on y=0, 1.6 m tall, facing +Z (Meshy rigs face +Z already)
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  const k = 1.6 / h;
  model.scale.setScalar(k);
  model.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
  root.add(model);
  const bones: Record<string, THREE.Bone> = {};
  let yMin = Infinity, yMax = -Infinity;
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    const m = o as THREE.SkinnedMesh;
    if (m.isMesh) {
      m.frustumCulled = false;
      m.renderOrder = 1;
      const src = m.material as THREE.MeshStandardMaterial;
      // 4K base colour + Meshy's normal map (fabric folds, buttons, hair strands); anisotropic filtering keeps the
      // texture crisp where the dress turns away from the camera
      if (src.map) src.map.anisotropy = 8;
      if (src.normalMap) src.normalMap.anisotropy = 8;
      const mat = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap ?? null, normalScale: new THREE.Vector2(1.25, 1.25), roughness: 0.62, metalness: 0, side: THREE.FrontSide });
      patchMaterial(mat);
      flowUniforms.uHairMap.value = src.map;
      m.material = mat;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 7) { const y = pos.getY(i); if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
    }
  });
  flowUniforms.uFlowY0.value = yMin;
  guideUniforms.uHairLit.value = (new URLSearchParams(location.search).get('off') ?? '').split(',').includes('hairlight') ? 0 : 1;
  flowUniforms.uFlowH.value = yMax - yMin;
  const dbg = new URLSearchParams(location.search);
  if (!dbg.has('noreweight')) model.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) reweightSkirt(m, yMin, yMax - yMin); });
  if (!dbg.has('noslim')) {
    model.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) slimBody(m, yMin, yMax - yMin); });
    // narrower shoulders: the collarbones are 22% shorter, so each arm (and the skin bound to it) sits ~2.5 cm further
    // in. The clips key every bone's (constant) offset, so the clip tracks change with the rest pose.
    for (const n of ['LeftArm', 'RightArm']) bones[n]?.position.multiplyScalar(SHOULDER_K);
    for (const c of g.animations) for (const t of c.tracks) if (/^(Left|Right)Arm\.position$/.test(t.name)) for (let i = 0; i < t.values.length; i++) t.values[i] *= SHOULDER_K;
  }
  // ground contact: the lowest point of the bind pose (shoe soles) sits on y = 0 after normalising
  (flowUniforms as any).off = dbg.has('noflow');
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.62), new THREE.MeshBasicMaterial({
    map: softDisc([[0, 0, 0, 0.92], [0, 0, 0, 0.55], [0, 0, 0, 0]], [0, 0.45, 1]), transparent: true, depthWrite: false, opacity: 0.95 }));
  occludeShadow(contact.material as THREE.MeshBasicMaterial);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.004;
  root.add(contact);
  const ground = { ao: 0.7 };
  const feet = footShadows(root, bones, ground);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({
    map: softDisc([[90, 255, 220, 0.9], [40, 200, 180, 0.35], [0, 0, 0, 0]], [0, 0.5, 1]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.003;
  pool.visible = false;
  root.add(pool);
  const rig: MeshyRig = { root, headCenter: bones.Head ?? model, contact, pool, bones, feet, ground };
  return { rig, anim: new MeshyAnimator(rig, model, g.animations) };
}

/** Collarbone length kept (anime proportions: narrow shoulders). */
const SHOULDER_K = 0.78;

/**
 * Slimmer, anime-girl proportions on the same mesh (the face, hair and dress design are untouched): the chest and
 * waist narrow toward the spine (12% across, 6% front to back), the neck and arms slim around their own bones, the
 * skirt narrows a little. Bind-space vertex edit, so every clip and the skinning stay exactly as they were.
 */
function slimBody(mesh: THREE.SkinnedMesh, y0: number, h: number) {
  const sk = mesh.skeleton, g = mesh.geometry;
  const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const bindInv = new THREE.Matrix4().copy(mesh.bindMatrix).invert();
  const idx = (n: string) => sk.bones.findIndex((b) => b.name === n);
  const bindPos = (n: string) => { const k = idx(n); return k < 0 ? null : new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[k]).invert().premultiply(bindInv)); };
  const torso = new Set(['Spine', 'Spine01', 'Spine02', 'Hips'].map(idx)), neck = idx('neck');
  const armAll = new Set(sk.bones.map((b, k) => (/Shoulder|Arm|Hand/.test(b.name) ? k : -1)).filter((k) => k >= 0));
  const segs: { a: THREE.Vector3; b: THREE.Vector3; ids: Set<number>; k: number }[] = [];
  for (const side of ['Left', 'Right']) {
    const sh = bindPos(`${side}Arm`), el = bindPos(`${side}ForeArm`), wr = bindPos(`${side}Hand`);
    if (sh && el && wr) {
      segs.push({ a: sh, b: el, ids: new Set([idx(`${side}Arm`)]), k: 0.85 });
      segs.push({ a: el, b: wr, ids: new Set([idx(`${side}ForeArm`)]), k: 0.87 });
    }
  }
  const nA = bindPos('neck'), nB = bindPos('Head');
  const cx = bindPos('Spine01')?.x ?? 0, cz = bindPos('Spine01')?.z ?? 0;
  const p = new THREE.Vector3(), c = new THREE.Vector3(), line = new THREE.Line3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const frac = (p.y - y0) / h;
    let wT = 0, wN = 0, wA = 0;
    const wArm = segs.map(() => 0);
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(i, k), w = sw.getComponent(i, k);
      if (torso.has(b)) wT += w; else if (b === neck) wN += w;
      if (armAll.has(b)) wA += w;
      segs.forEach((s, j) => { if (s.ids.has(b)) wArm[j] += w; });
    }
    const q = p.clone();
    // chest and waist (above the skirt band, below the head): toward the spine's line
    if (wT > 0 && frac > 0.55 && frac < 0.86) {
      const t = wT * THREE.MathUtils.smoothstep(frac, 0.55, 0.62) * (1 - THREE.MathUtils.smoothstep(frac, 0.82, 0.86));
      q.x = cx + (p.x - cx) * (1 - 0.12 * t); q.z = cz + (p.z - cz) * (1 - 0.06 * t);
    } else if (frac > 0.22 && frac <= 0.55 && wA === 0) {
      // skirt: a touch narrower side to side (it hangs from the hips; front-back stays so the legs never poke through)
      const t = THREE.MathUtils.smoothstep(frac, 0.22, 0.45);
      q.x = cx + (p.x - cx) * (1 - 0.05 * t);
    }
    if (wN > 0.3 && nA && nB) { line.set(nA, nB); line.closestPointToPoint(p, true, c); q.lerp(c.clone().add(p.clone().sub(c).multiplyScalar(0.88)), wN); }
    segs.forEach((s, j) => {
      if (wArm[j] <= 0) return;
      line.set(s.a, s.b); line.closestPointToPoint(p, true, c);
      q.add(c.clone().add(p.clone().sub(c).multiplyScalar(s.k)).sub(p).multiplyScalar(wArm[j]));
    });
    pos.setXYZ(i, q.x, q.y, q.z);
  }
  pos.needsUpdate = true; // (normals kept: the shape change is small, and recomputing would split the UV seams)
}

/**
 * Meshy's auto-rig binds the long skirt to the thighs, so strides split it into trouser legs. Re-weight the skirt band
 * (between waist and hem, away from the arms) mostly to the hips: 100% at the waist, 55% at the hem, so the legs stride
 * inside a skirt that swings as one piece (the flow shader adds the swing).
 */
function reweightSkirt(mesh: THREE.SkinnedMesh, y0: number, h: number) {
  const hips = mesh.skeleton.bones.findIndex((b) => b.name === 'Hips');
  if (hips < 0) return;
  const g = mesh.geometry;
  const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const waist = 0.6, hem = 0.22;
  // joint positions in the vertices' space: bindMatrix^-1 * boneInverse^-1 * origin (not bindMatrixInverse, which
  // three overwrites every frame in 'attached' mode)
  const bindInv = new THREE.Matrix4().copy(mesh.bindMatrix).invert();
  const bindPos = (name: string) => {
    const k = mesh.skeleton.bones.findIndex((b) => b.name === name);
    if (k < 0) return null;
    const m = new THREE.Matrix4().copy(mesh.skeleton.boneInverses[k]).invert().premultiply(bindInv);
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  // arms hang out to the sides in the A-pose: never re-weight hand / forearm skin that dips below the waist
  const armSegs: [THREE.Vector3, THREE.Vector3][] = [];
  for (const side of ['Left', 'Right']) {
    const a = bindPos(`${side}Arm`), b = bindPos(`${side}ForeArm`), c = bindPos(`${side}Hand`);
    if (a && b) armSegs.push([a, b]);
    if (b && c) armSegs.push([b, c.clone().add(c.clone().sub(b).multiplyScalar(0.6))]);
  }
  const tmp = new THREE.Vector3(), seg = new THREE.Line3(), closest = new THREE.Vector3();
  const armDist = (p: THREE.Vector3) => {
    let d = Infinity;
    for (const [a, b] of armSegs) { seg.set(a, b); seg.closestPointToPoint(p, true, closest); d = Math.min(d, closest.distanceTo(p)); }
    return d;
  };
  const armR = 0.05 * h;
  const armIdx = new Set(mesh.skeleton.bones.map((b, k) => (/Shoulder|Arm|Hand/.test(b.name) ? k : -1)).filter((k) => k >= 0));
  for (let i = 0; i < pos.count; i++) {
    const frac = (pos.getY(i) - y0) / h;
    if (frac > waist || frac < hem) continue;
    tmp.fromBufferAttribute(pos, i);
    if (armSegs.length && armDist(tmp) < armR) continue;
    const band = THREE.MathUtils.smoothstep(frac, hem, hem + 0.06) * THREE.MathUtils.smoothstep(frac, waist + 0.02, waist - 0.06);
    if (band <= 0.001) continue;
    const t = (waist - frac) / (waist - hem);
    const hipShare = (1 - 0.45 * Math.pow(t, 1.3)) * band;
    const idx = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
    // cloth never follows the arms
    const wt = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)].map((w, k) => (armIdx.has(idx[k]) ? 0 : w * (1 - hipShare)));
    const hi = idx.indexOf(hips);
    if (hi >= 0) wt[hi] += hipShare;
    else { const lo = wt.indexOf(Math.min(...wt)); idx[lo] = hips; wt[lo] = hipShare; }
    const sum = wt.reduce((a, b) => a + b, 0) || 1;
    si.setXYZW(i, idx[0], idx[1], idx[2], idx[3]);
    sw.setXYZW(i, wt[0] / sum, wt[1] / sum, wt[2] / sum, wt[3] / sum);
  }
  si.needsUpdate = true;
  sw.needsUpdate = true;
}

const GESTURE_CLIP: Partial<Record<Gesture, string[]>> = {
  wave: ['wave_hand'], // a natural one-hand hello (the intro)
  waveBig: ['wave_hand'], // "catch up!" down the corridor: same wave, played quicker
  dance: ['dance_joy', 'dance_groove'],
  tada: ['cheer'],
  talk: ['talk_open', 'agree', 'talk_hip'],
  // lookAround / lookBack: the base idle already looks around (a gesture must never reuse the idle clip: its weight
  // would be overwritten and the bind A-pose would show through)
  beckon: ['call'],
  handOnHip: ['talk_hip'],
  // fidgetHeadband / tapFoot: the calm idle covers them ("Happy Sway" spreads her arms wide mid-loop: odd for a guide)
  // point: the presenting clip (talk_right / talk_left) is time-controlled in update(), not picked here
};

const smooth01 = (x: number) => THREE.MathUtils.smoothstep(x, 0, 1);

// (the jog clip alone reads as a hunched sprint in a dress: she only jogs when the visitor presses hard on the walk pad,
// and then as a light jog, JOG_MIX of the jog over the brisk walk on the shared cycle: upright, a small kick, short flight)
const GAIT_CLIPS = new URLSearchParams(location.search).get('gaits')?.split(',') ?? ['walk_casual', 'walk', 'jog'];
const JOG_MIX = parseFloat(new URLSearchParams(location.search).get('jogmix') ?? '0.45');
interface Gait { name: string; a: THREE.AnimationAction; dur: number; n: number; t0: number; v0: number; cyc: number; floor: number }

/** Presenting clip timeline (talk_right / talk_left, 3.7 s): the arm opens out by ~0.9 s, holds, lowers after ~1.9 s. */
const PRESENT = { reach: 1.0, holdA: 1.05, holdB: 1.7, end: 3.4 };

/** Clip-driven animator with the same update() contract as the procedural GuideAnimator. */
export class MeshyAnimator {
  mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private loco = { idle: 1, walk: 0, run: 0, turnL: 0, turnR: 0 };
  private gesture: Gesture = 'none';
  private gestureAction: THREE.AnimationAction | null = null;
  private prevGesture: THREE.AnimationAction | null = null;
  private gestW = 0; // our own crossfades (mixer fades are cancelled by per-frame weights)
  private prevW = 0;
  phase = 0;
  private t = 0;
  talking = false;
  /** Presenting weight (0..1) and side, read by the app for the pointer beam. */
  pointW = 0;
  pointSide: 'Left' | 'Right' = 'Right';
  private presentT = 0; // presenting clip time we drive by hand
  private presentDir = 1; // ping-pong direction inside the hold
  private presenting = false;
  private presentSince = 0;
  private sideFlipT = 0;
  private lastPointAt = new THREE.Vector3();
  private skirtHold = 0;
  private railW = 0;
  private railLocal = new THREE.Vector3();
  private railSideNow: 'Left' | 'Right' = 'Right';
  /** (owner: a polite hand as she passes people) 0..1 weight of the pass-by hand, its side and how long it has been up */
  passW = 0;
  private passOff = (new URLSearchParams(location.search).get('off') ?? '').split(',').includes('passhand');
  private passSide: 'Left' | 'Right' = 'Right';
  private passT = 0;
  private energy = 0;
  private grooveW = 0;
  private spS = 0;
  private running = false;
  private walkCal = 1;
  private runCal = 1;
  private footPrev = { L: new THREE.Vector3(), R: new THREE.Vector3(), ok: false };
  private lookYaw = 0;
  private q = new THREE.Quaternion();
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private va = new THREE.Vector3();
  private vb = new THREE.Vector3();
  private vc = new THREE.Vector3();
  private vd = new THREE.Vector3();
  private noFem = new URLSearchParams(location.search).has('nofem'); // (dev: compare with the plain clip)
  private lastPos = new THREE.Vector3();

  constructor(public rig: MeshyRig, model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    // soles touch y = 0 in the bind pose (loadMeshyRig normalises on it): remember that foot height
    {
      const B = rig.bones, v = new THREE.Vector3();
      rig.root.updateMatrixWorld(true);
      if (B.LeftFoot && B.RightFoot) this.bindFloor = Math.min(B.LeftFoot.getWorldPosition(v).y, B.RightFoot.getWorldPosition(v).y) - rig.root.position.y;
      if (B.LeftToeBase && B.RightToeBase) this.bindToe = Math.min(B.LeftToeBase.getWorldPosition(v).y, B.RightToeBase.getWorldPosition(v).y) - rig.root.position.y;
    }
    this.mixer = new THREE.AnimationMixer(model);
    for (const c of clips) {
      const a = this.mixer.clipAction(c);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.actions.set(c.name, a);
    }
    for (const n of ['cheer']) {
      const a = this.actions.get(n);
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.stop(); }
    }
    for (const n of ['talk_right', 'talk_left', ...GAIT_CLIPS]) { const a = this.actions.get(n); if (a) a.setEffectiveTimeScale(0); }
    // gaits: measure each stride clip (metres per cycle, cycles per clip, left-heel-strike time, ground level), so
    // clips advance by the distance she actually moves (planted foot stays put by construction) on one shared cycle
    this.groundRef = this.footFloor('idle');
    for (const n of GAIT_CLIPS) { const g = this.analyseGait(n); if (g) this.gaits.push(g); }
    this.gaits.sort((x, y) => x.v0 - y.v0);
    (this as any).gaitInfo = this.gaits.map((g) => ({ name: g.name, v0: +g.v0.toFixed(2), cyc: +g.cyc.toFixed(2), n: g.n, floor: +(g.floor - this.groundRef).toFixed(3) }));
    // one-shot clips hand their weight back when done
    this.mixer.addEventListener('finished', (e: any) => { e.action.setEffectiveWeight(0); e.action.stop(); });
    this.lastPos.copy(rig.root.position);
  }

  private act(name: string) { return this.actions.get(name); }

  private gaits: Gait[] = [];
  private gPhase = 0;
  private jogging = false;
  private gaitW: number[] = [];
  private groundRef = 0;
  private bindFloor = NaN;
  private bindToe = 0;
  /** lowest foot height of a clip (root space) */
  private footFloor(name: string) {
    const a = this.act(name), B = this.rig.bones;
    if (!a || !B.LeftFoot || !B.RightFoot) return 0;
    for (const x of this.actions.values()) x.setEffectiveWeight(0);
    a.setEffectiveWeight(1);
    let m = Infinity; const v = new THREE.Vector3(), dur = a.getClip().duration;
    for (let i = 0; i <= 40; i++) { a.time = (dur * i) / 40; this.mixer.update(0); this.rig.root.updateMatrixWorld(true); m = Math.min(m, B.LeftFoot.getWorldPosition(v).y, B.RightFoot.getWorldPosition(v).y); }
    a.setEffectiveWeight(0);
    return m;
  }
  /**
   * Measure a stride clip in root space: a foot within 3 cm of the clip's lowest foot height is on the ground and moves
   * backward at the clip's ground speed (runs have flight phases, so only contact samples count); left-heel strikes
   * (left foot touching down) mark the cycles.
   */
  private analyseGait(name: string): Gait | null {
    const a = this.act(name), B = this.rig.bones;
    if (!a || !B.LeftFoot || !B.RightFoot) return null;
    const dur = a.getClip().duration, root = this.rig.root;
    root.position.set(0, 0, 0); root.quaternion.identity(); root.updateMatrixWorld(true);
    for (const x of this.actions.values()) x.setEffectiveWeight(0);
    a.setEffectiveWeight(1);
    const N = Math.max(120, Math.round(dur * 60)), v = new THREE.Vector3();
    const L: [number, number][] = [], R: [number, number][] = [];
    for (let i = 0; i <= N; i++) {
      a.time = (dur * i) / N;
      this.mixer.update(0);
      root.updateMatrixWorld(true);
      B.LeftFoot.getWorldPosition(v); L.push([v.z, v.y]);
      B.RightFoot.getWorldPosition(v); R.push([v.z, v.y]);
    }
    a.setEffectiveWeight(0);
    const minY = Math.min(...L.map((x) => x[1]), ...R.map((x) => x[1]));
    const on = (F: [number, number][], i: number) => F[i][1] < minY + 0.03;
    let sumV = 0, n = 0;
    for (const F of [L, R]) for (let i = 1; i <= N; i++) if (on(F, i) && on(F, i - 1)) { sumV += (F[i - 1][0] - F[i][0]) / (dur / N); n++; }
    const v0 = n ? sumV / n : 0; // stance (ground) speed, m/s at clip rate 1
    if (v0 < 0.3 || v0 > 8) return null;
    const strikes: number[] = [];
    for (let i = 1; i <= N; i++) if (on(L, i) && !on(L, i - 1)) strikes.push((dur * i) / N);
    const cycles = Math.max(1, strikes.length);
    return { name, a, dur, n: cycles, t0: strikes[0] ?? 0, v0, cyc: (v0 * dur) / cycles, floor: minY };
  }

  /** Her right, measured from the skeleton (right shoulder minus left), horizontal. */
  private herRight(out = new THREE.Vector3()) {
    const B = this.rig.bones, r = B.RightArm ?? B.RightShoulder, l = B.LeftArm ?? B.LeftShoulder;
    if (!r || !l) return out.set(-1, 0, 0).applyQuaternion(this.rig.root.getWorldQuaternion(this.q)).setY(0).normalize();
    const pr = r.getWorldPosition(this.va), pl = l.getWorldPosition(this.vb);
    return out.subVectors(pr, pl).setY(0).normalize();
  }
  private herFwd(out = new THREE.Vector3()) {
    return out.set(0, 0, 1).applyQuaternion(this.rig.root.getWorldQuaternion(this.q)).setY(0).normalize();
  }

  /** Apply a world-space rotation to a bone (blended by k), converting into its parent space. */
  private rotateWorld(bone: THREE.Bone, delta: THREE.Quaternion, k: number) {
    this.qb.identity().slerp(delta, k);
    const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
    const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    bone.quaternion.copy(parentQ.invert().multiply(this.qb.clone().multiply(worldQ)));
    bone.updateMatrixWorld(true);
  }

  /** Rotate `bone` so the direction from it to `end` (a descendant's world position) swings to `desired`. */
  private swingTo(bone: THREE.Bone, end: THREE.Object3D, desired: THREE.Vector3, k: number) {
    bone.updateMatrixWorld(true);
    const p0 = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    const cur = new THREE.Vector3().setFromMatrixPosition(end.matrixWorld).sub(p0).normalize();
    this.rotateWorld(bone, this.qa.setFromUnitVectors(cur, desired.clone().normalize()), k);
  }

  /** Two-bone reach: the hand lands on a root-local target; the elbow bends outward (away from her body). */
  private reach(side: 'Left' | 'Right', targetLocal: THREE.Vector3, w: number, elbowBack = 0.4) {
    const B = this.rig.bones;
    const arm = B[`${side}Arm`], fore = B[`${side}ForeArm`], hand = B[`${side}Hand`];
    if (!arm || !fore || !hand) return;
    const root = this.rig.root;
    root.updateMatrixWorld(true);
    arm.updateMatrixWorld(true);
    const target = this.vc.copy(targetLocal).applyMatrix4(root.matrixWorld);
    const sh = new THREE.Vector3().setFromMatrixPosition(arm.matrixWorld);
    const el = new THREE.Vector3().setFromMatrixPosition(fore.matrixWorld), wr = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
    const l1 = sh.distanceTo(el), l2 = el.distanceTo(wr);
    const toT = target.clone().sub(sh);
    const d = Math.min(toT.length(), (l1 + l2) * 0.985);
    toT.normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const a = Math.acos(cosA);
    // elbow pole: out to her side and a little back
    const sideV = side === 'Right' ? this.herRight() : this.herRight().negate();
    const pole = sideV.clone().addScaledVector(this.herFwd(), -elbowBack).normalize();
    const perp = pole.clone().addScaledVector(toT, -pole.dot(toT)).normalize();
    const upperDir = toT.clone().multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a)).normalize();
    this.swingTo(arm, fore, upperDir, w);
    fore.updateMatrixWorld(true);
    const el2 = new THREE.Vector3().setFromMatrixPosition(fore.matrixWorld);
    this.swingTo(fore, hand, target.clone().sub(el2).normalize(), w);
  }

  // ---- foot lock: per-clip playback calibration (the planted foot must not skate over the floor)
  private calibrateFeet(dt: number, sp: number) {
    const B = this.rig.bones, lf = B.LeftFoot, rf = B.RightFoot;
    if (!lf || !rf || dt <= 0) return;
    const l = lf.getWorldPosition(new THREE.Vector3()), r = rf.getWorldPosition(new THREE.Vector3());
    if (this.footPrev.ok && sp > 0.35 && this.skirtHold < 0.2 && this.pointW < 0.05) {
      const planted = l.y < r.y ? 'L' : 'R';
      const cur = planted === 'L' ? l : r, prev = this.footPrev[planted];
      const fwd = this.herFwd();
      const vAlong = ((cur.x - prev.x) * fwd.x + (cur.z - prev.z) * fwd.z) / dt;
      const err = THREE.MathUtils.clamp(vAlong / Math.max(sp, 0.4), -0.6, 0.6);
      const k = Math.min(1, dt * 0.8);
      if (this.loco.walk > 0.7) this.walkCal = THREE.MathUtils.clamp(this.walkCal * (1 + err * k), 0.8, 1.25);
      else if (this.loco.run > 0.7) this.runCal = THREE.MathUtils.clamp(this.runCal * (1 + err * k), 0.8, 1.25);
    }
    this.footPrev.L.copy(l); this.footPrev.R.copy(r); this.footPrev.ok = true;
  }

  /**
   * Presenting: the mocap "open palm to the side" pose (talk_right / talk_left) is the base: a natural shoulder, elbow
   * and palm. On top, her chest turns a little toward the work and the whole arm swings (elbow bend kept) so the
   * open hand points at it, with the elevation kept in a natural band (never straight up, never at her feet).
   */
  private aimPresent(side: 'Left' | 'Right', targetLocal: THREE.Vector3, w: number) {
    const B = this.rig.bones;
    const arm = B[`${side}Arm`], hand = B[`${side}Hand`], chest = B.Spine02 ?? B.Spine01;
    if (!arm || !hand) return;
    const root = this.rig.root;
    root.updateMatrixWorld(true);
    const target = new THREE.Vector3().copy(targetLocal).applyMatrix4(root.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0);
    // chest: up to ~20 degrees toward the work (people turn their shoulders into a presenting gesture)
    if (chest) {
      arm.updateMatrixWorld(true);
      const sh = new THREE.Vector3().setFromMatrixPosition(arm.matrixWorld);
      const hp = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
      const curAz = Math.atan2(hp.x - sh.x, hp.z - sh.z), tgtAz = Math.atan2(target.x - sh.x, target.z - sh.z);
      let dAz = tgtAz - curAz; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
      this.rotateWorld(chest, this.qa.setFromAxisAngle(up, THREE.MathUtils.clamp(dAz * 0.35, -0.35, 0.35)), w);
    }
    arm.updateMatrixWorld(true);
    const sh = new THREE.Vector3().setFromMatrixPosition(arm.matrixWorld);
    const hp = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
    const cur = hp.clone().sub(sh).normalize();
    const to = target.clone().sub(sh);
    const horiz = Math.hypot(to.x, to.z) || 1;
    const curEl = Math.asin(THREE.MathUtils.clamp(cur.y, -1, 1));
    const tgtEl = Math.atan2(to.y, horiz);
    // a guide's presenting hand sits a little below the shoulder (reference photos: ~10-35 degrees below horizontal),
    // only rising toward horizontal for works hung high
    const el = THREE.MathUtils.clamp(-0.32 + tgtEl * 0.35, -0.6, -0.08);
    void curEl;
    const desired = new THREE.Vector3(to.x / horiz * Math.cos(el), Math.sin(el), to.z / horiz * Math.cos(el));
    // never swing the arm more than ~65 degrees from the clip's pose (no reaching behind her back or across her body)
    const ang = cur.angleTo(desired), maxA = 1.13;
    if (ang > maxA) desired.copy(cur).lerp(desired, maxA / ang).normalize();
    this.swingTo(arm, hand, desired, w);
    // the shoulder girdle rises a little with the arm (POSTURE checklist: a clavicle that never moves reads as fake)
    const clav = B[`${side}Shoulder`];
    if (clav) this.rotateWorld(clav, this.qa.setFromAxisAngle(this.herFwd(), (side === 'Right' ? 1 : -1) * 0.1), w);
  }

  /**
   * "Come on, catch up!" from down the corridor (POSTURE §3B): the arm goes high and nearly straight and sweeps side to
   * side from the shoulder at ~1.2 Hz, the shoulder lifting with it, amplitude varying a little per sweep.
   */
  /**
   * (owner: "as she waves at the start her arm goes into her hair and body; make the wave more subtle and quick")
   * A small friendly hello: upper arm out to her side ~70 degrees from hanging (elbow clear of the body, below
   * shoulder height), forearm up with the elbow bent ~90 degrees, the hand waving from the elbow 2.2 times a second.
   * The forearm only ever tilts outward (2-27 degrees from vertical, away from her head): it never crosses her hair or
   * face. Replaces the clip's arm for 'wave' and 'waveBig'.
   */
  private bigWave(w: number) {
    const B = this.rig.bones, arm = B.RightArm, fore = B.RightForeArm, hand = B.RightHand;
    if (!arm || !fore || !hand) return;
    const right = this.herRight(), fwd = this.herFwd(), up = new THREE.Vector3(0, 1, 0);
    const ab = 1.22; // 70 degrees out from hanging
    const dir = up.clone().multiplyScalar(-Math.cos(ab)).addScaledVector(right, Math.sin(ab)).addScaledVector(fwd, 0.3).normalize();
    this.swingTo(arm, fore, dir, w);
    const a = 0.25 + 0.21 * Math.sin(this.t * Math.PI * 2 * 2.2);
    const fdir = up.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a)).addScaledVector(fwd, 0.18).normalize();
    this.swingTo(fore, hand, fdir, w);
  }

  /**
   * Feminine walk style over the Walking Woman clip: the hips sway over the stance foot and turn with the swinging
   * leg (the skirt hangs from the hips, so it sways too) while the chest counters the turn, the feet land closer to
   * one line, and the arms swing close to the body with a soft outward turn of the wrists. No pelvic roll: tilting the
   * pelvis lifted the stance foot and let the plant slip (foot slide p95 at 2 m/s 0.55 -> 1.8 m/s). Phase 0 = left
   * heel strike (gPhase).
   */
  private feminineWalk(w: number) {
    const B = this.rig.bones, hips = B.Hips;
    if (!hips || w <= 0.001) return;
    const ph = this.gPhase * Math.PI * 2, s = Math.sin(ph), c = Math.cos(ph);
    const fwd = this.herFwd(), right = this.herRight(), up = this.vb.set(0, 1, 0);
    // hips: 1.4 cm over the stance foot, turned 6 degrees with the swing leg
    if (hips.parent) {
      const d = this.va.copy(right).multiplyScalar(-0.014 * s * w);
      const pq = hips.parent.getWorldQuaternion(this.q).invert(), sc = hips.parent.getWorldScale(this.vd).x || 1;
      hips.position.add(d.applyQuaternion(pq).divideScalar(sc));
      hips.updateMatrixWorld(true);
    }
    this.rotateWorld(hips, this.qa.setFromAxisAngle(up, -0.11 * c), w);
    // chest counters the turn
    if (B.Spine) this.rotateWorld(B.Spine, this.qa.setFromAxisAngle(up, 0.11 * c), w);
    // feet toward one line: the thighs turn in a little
    if (B.LeftUpLeg) this.rotateWorld(B.LeftUpLeg, this.qa.setFromAxisAngle(fwd, -0.04), w);
    if (B.RightUpLeg) this.rotateWorld(B.RightUpLeg, this.qa.setFromAxisAngle(fwd, 0.04), w);
    // arms closer to the body, wrists turned softly out
    if (B.LeftArm) this.rotateWorld(B.LeftArm, this.qa.setFromAxisAngle(fwd, -0.07), w);
    if (B.RightArm) this.rotateWorld(B.RightArm, this.qa.setFromAxisAngle(fwd, 0.07), w);
    if (B.LeftHand) this.rotateWorld(B.LeftHand, this.qa.setFromAxisAngle(fwd, 0.22), w);
    if (B.RightHand) this.rotateWorld(B.RightHand, this.qa.setFromAxisAngle(fwd, -0.22), w);
  }

  /**
   * (owner: "as she's walking into the dance room, have her dancing as she walks, to the beat") a groove on top of the
   * walk, keyed to the music's beat: a dip on every beat (the plant bends the knees), hips swaying side to side over two
   * beats with the chest and head countering, a nod on the beat, elbows bent and the arms pumping in turn.
   */
  private danceWalk(w: number, beat: number) {
    const B = this.rig.bones, hips = B.Hips;
    if (!hips || w <= 0.001) return;
    const b = beat - Math.floor(beat);
    const dip = (0.5 + 0.5 * Math.cos(2 * Math.PI * b)) ** 2; // 1 on the beat
    const sway = Math.cos(Math.PI * beat); // +-1 on alternate beats
    const fwd = this.herFwd(), right = this.herRight(), up = this.vb.set(0, 1, 0);
    if (hips.parent) {
      const d = this.va.copy(right).multiplyScalar(0.022 * sway * w).addScaledVector(up, -0.024 * dip * w);
      const pq = hips.parent.getWorldQuaternion(this.q).invert(), sc = hips.parent.getWorldScale(this.vd).x || 1;
      hips.position.add(d.applyQuaternion(pq).divideScalar(sc));
      hips.updateMatrixWorld(true);
    }
    this.rotateWorld(hips, this.qa.setFromAxisAngle(fwd, 0.07 * sway), w);
    if (B.Spine01) { this.rotateWorld(B.Spine01, this.qa.setFromAxisAngle(fwd, -0.1 * sway), w); this.rotateWorld(B.Spine01, this.qa.setFromAxisAngle(up, 0.09 * sway), w); }
    if (B.Head) { this.rotateWorld(B.Head, this.qa.setFromAxisAngle(right, -0.11 * dip), w); this.rotateWorld(B.Head, this.qa.setFromAxisAngle(fwd, -0.07 * sway), w); }
    // arms set outright (not added to the walk's swing, which left one arm sticking out straight): upper arm down and a
    // little out, swinging forward / back in turn; elbow bent ~120 degrees, hands up in front at chest height, bouncing on the beat
    for (const side of ['Left', 'Right'] as const) {
      const arm = B[`${side}Arm`], fore = B[`${side}ForeArm`], hand = B[`${side}Hand`];
      if (!arm || !fore || !hand) continue;
      const out = side === 'Right' ? 1 : -1;
      const pump = Math.cos(Math.PI * beat + (side === 'Left' ? 0 : Math.PI)); // one arm forward on each beat
      const ad = this.vc.copy(up).multiplyScalar(-1).addScaledVector(fwd, 0.12 + 0.3 * pump).addScaledVector(right, 0.32 * out);
      this.swingTo(arm, fore, ad, w);
      const fd = this.vd.copy(fwd).multiplyScalar(0.7).addScaledVector(up, 0.62 + 0.3 * dip).addScaledVector(right, 0.06 * out);
      this.swingTo(fore, hand, fd, w);
    }
  }

  /**
   * (owner: "as she walks by people, have her slowly hover her hand past them, to get by politely") a small "excuse
   * me" hand: the upper arm a little out to the person's side and forward (~28 degrees from hanging), the forearm
   * raised forward to about waist height (elbow soft), the palm turned down / out toward them. While it is up the hand
   * drifts slowly back along her side, as if keeping a polite space while she slips past. Over the walk's own arm.
   */
  private passHand(w: number, side: 'Left' | 'Right', t: number) {
    const B = this.rig.bones, arm = B[`${side}Arm`], fore = B[`${side}ForeArm`], hand = B[`${side}Hand`];
    if (!arm || !fore || !hand) return;
    const out = side === 'Right' ? 1 : -1;
    const right = this.herRight(this.va), fwd = this.herFwd(this.vb), up = this.v.set(0, 1, 0);
    const drift = smooth01(Math.min(1, t / 1.8)); // forward first, then back along her side as she passes
    const ad = this.vc.copy(up).multiplyScalar(-0.85).addScaledVector(right, 0.52 * out).addScaledVector(fwd, 0.26 - 0.26 * drift);
    this.swingTo(arm, fore, ad, w);
    const fd = this.vd.copy(up).multiplyScalar(-0.42).addScaledVector(fwd, 0.5 - 0.2 * drift).addScaledVector(right, 0.62 * out);
    this.swingTo(fore, hand, fd, w);
    // palm down / out: the hand turned about the forearm (pronation) and tipped a little up at the wrist
    fore.updateMatrixWorld(true);
    const fa = this.vc.setFromMatrixPosition(hand.matrixWorld).sub(this.vd.setFromMatrixPosition(fore.matrixWorld)).normalize();
    this.rotateWorld(hand, this.qa.setFromAxisAngle(fa, -out * 0.9), w);
    this.rotateWorld(hand, this.qa.setFromAxisAngle(this.vd.copy(fa).cross(up).normalize(), -0.25 * out), w);
  }

  /** Stairs: both hands gather the skirt at her sides (front of the thighs), elbows out and back. */
  private holdSkirt(w: number) {
    // docs/POSTURE.md §5 (real photos): the skirt is pinched at the side seam, a little forward, hands at about hip
    // joint height (0.82-0.92 m), arms long with soft elbows, held steady (no swing); trunk leans 5-12 degrees forward
    // and the head looks 2-3 treads ahead
    const B = this.rig.bones, right = this.herRight(), up = new THREE.Vector3(0, 1, 0);
    if (B.Spine01) this.rotateWorld(B.Spine01, this.qa.setFromAxisAngle(right, -0.14), w);
    if (B.Head) this.rotateWorld(B.Head, this.qa.setFromAxisAngle(right, -0.2), w);
    void up;
    // ~10 cm above her relaxed wrist (her arms are shorter than the 1.6 m adult the spec measures), elbows soft and
    // pointing back, not out (out reads as hands on hips)
    this.reach('Right', new THREE.Vector3(-0.19, 0.8, 0.09), w, 2.2);
    this.reach('Left', new THREE.Vector3(0.19, 0.8, 0.09), w, 2.2);
  }

  /**
   * Foot planting (foot IK): while a foot is on the ground its contact point stays where it touched down, even as her
   * root curves, eases speed or turns on the spot. The contact point follows the roll: the heel/ankle from strike to
   * flat foot, the ball of the foot (toe bone) once the heel lifts, re-anchored at the switch so nothing jumps. The
   * knee bends in the clip's own plane and the foot keeps the clip's orientation. Contact: ankle within 3 cm of
   * standing height or ball within 1.5 cm of the floor; released when both lift, or when the hold would pull the foot
   * too far from where the clip put it (see tooFar). Blends in over ~60 ms, out over ~100 ms.
   */
  private plantFeet(dt: number, w: number, stairs: boolean) {
    const B = this.rig.bones, root = this.rig.root;
    if (!Number.isFinite(this.bindFloor)) return;
    root.updateMatrixWorld(true);
    for (const side of ['Left', 'Right'] as const) {
      const up = B[`${side}UpLeg`], leg = B[`${side}Leg`], foot = B[`${side}Foot`], toe = B[`${side}ToeBase`], L = this.plant[side];
      if (!up || !leg || !foot) continue;
      const anim = foot.getWorldPosition(new THREE.Vector3());
      const ball = toe ? toe.getWorldPosition(new THREE.Vector3()) : anim;
      const ankleH = anim.y - root.position.y - this.bindFloor, ballH = ball.y - root.position.y - this.bindToe;
      const heelUp = toe ? anim.y - ball.y > this.bindFloor - this.bindToe + 0.02 : false;
      const pt = heelUp ? ball : anim;
      up.updateMatrixWorld(true);
      const hip = new THREE.Vector3().setFromMatrixPosition(up.matrixWorld);
      // how far the hold may pull the foot from where the clip put it before letting go: 0.15 m (further bends the
      // ankle past what the skin can take, and a later release snaps back further). On stairs the faster cadence
      // shortens every step, so there it may also pull the foot up to 0.28 m in under the hip along her facing
      // (0.2 m sideways at most) while the leg can still reach without locking straight.
      const tooFar = () => {
        const c = L.corr.length();
        if (c <= 0.15) return false;
        if (!stairs) return true;
        const fwd = this.herFwd(), along = Math.abs(L.corr.x * fwd.x + L.corr.z * fwd.z), side = Math.sqrt(Math.max(0, c * c - along * along));
        if (c > 0.28 || side > 0.2) return true;
        const knee = new THREE.Vector3().setFromMatrixPosition(leg.matrixWorld);
        const reach = hip.distanceTo(this.vd.copy(anim).add(L.corr)) / (hip.distanceTo(knee) + knee.distanceTo(anim));
        return reach > 0.97;
      };
      if (!L.on && (ankleH < 0.03 || ballH < 0.015) && w > 0.3) { L.on = true; L.toe = heelUp; L.anchor.copy(pt); L.corr.set(0, 0, 0); }
      else if (L.on && ((ankleH > 0.05 && ballH > 0.03) || w < 0.2 || tooFar())) L.on = false;
      if (L.on) {
        // the roll moved the contact to the other end of the foot: re-anchor there, continuing the current correction
        if (heelUp !== L.toe) { L.toe = heelUp; L.anchor.copy(pt).add(L.corr); }
        L.corr.set(L.anchor.x - pt.x, 0, L.anchor.z - pt.z);
      }
      L.k += ((L.on ? 1 : 0) - L.k) * Math.min(1, dt / (L.on ? 0.06 : 0.1));
      const k = L.k * w;
      if (k < 0.01) continue;
      const target = this.vc.copy(anim).addScaledVector(L.corr, k);
      const footQ = foot.getWorldQuaternion(new THREE.Quaternion());
      const knee = new THREE.Vector3().setFromMatrixPosition(leg.matrixWorld);
      const l1 = hip.distanceTo(knee), l2 = knee.distanceTo(anim);
      const toT = target.clone().sub(hip);
      const d = Math.min(toT.length(), (l1 + l2) * 0.995);
      toT.normalize();
      const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
      // pole: where the clip put the knee (keeps her knees forward and the clip's leg plane)
      const pole = knee.clone().sub(hip);
      const perp = pole.addScaledVector(toT, -pole.dot(toT));
      if (perp.lengthSq() < 1e-8) perp.copy(this.herFwd());
      perp.normalize();
      this.swingTo(up, leg, toT.clone().multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a)), 1);
      leg.updateMatrixWorld(true);
      const knee2 = new THREE.Vector3().setFromMatrixPosition(leg.matrixWorld);
      this.swingTo(leg, foot, target.clone().sub(knee2).normalize(), 1);
      // the foot keeps its clip orientation in the world (heel-toe roll from the clip, no twisting with the shin)
      const parentQ = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
      foot.quaternion.copy(parentQ.invert().multiply(footQ));
      foot.updateMatrixWorld(true);
    }
  }
  private plant = {
    Left: { on: false, toe: false, k: 0, anchor: new THREE.Vector3(), corr: new THREE.Vector3() },
    Right: { on: false, toe: false, k: 0, anchor: new THREE.Vector3(), corr: new THREE.Vector3() },
  };

  /** Stairs: lift the swinging leg's knee higher (a stepping-up gait on top of the walk clip). */
  private kneeLift(w: number) {
    const B = this.rig.bones;
    const right = this.herRight();
    const feet = (['Left', 'Right'] as const).map((s) => B[`${s}Foot`]?.getWorldPosition(new THREE.Vector3()).y ?? 0);
    const lo = Math.min(...feet);
    (['Left', 'Right'] as const).forEach((s, i) => {
      const up = B[`${s}UpLeg`], leg = B[`${s}Leg`], foot = B[`${s}Foot`];
      if (!up || !leg || !foot) return;
      const lift = THREE.MathUtils.smoothstep(feet[i] - lo, 0.01, 0.07) * w;
      if (lift < 0.01) return;
      // thigh forward/up about her right axis, shin back so the foot stays under the knee
      this.rotateWorld(up, this.qa.setFromAxisAngle(right, 0.5 * lift), 1);
      this.rotateWorld(leg, this.qa.setFromAxisAngle(right, -0.75 * lift), 1);
    });
  }

  update(inp: AnimInput) {
    const { dt } = inp;
    this.t += dt;
    const spRaw = Math.max(0, inp.speed);
    this.spS += (spRaw - this.spS) * Math.min(1, dt * 2.5);
    if (!this.running && this.spS > 2.2) this.running = true;
    else if (this.running && this.spS < 1.5) this.running = false;
    const sp = spRaw;
    this.grooveW += ((inp.groove ?? 0) * (sp > 0.3 ? 1 : 0) - this.grooveW) * Math.min(1, dt * 2.5);
    this.energy += ((inp.energy ?? 0) - this.energy) * Math.min(1, dt * 2);
    // stairs = the nav's measured staircase only: the floor slope from the camera solve crosses any threshold on solve
    // noise and seam steps (upstairs 2100-2230, 3400-3480), and stairs mode on a flat floor lifts the knees high
    const onStairs = !!inp.stairs;
    // ---- locomotion: walk / run, or small stepping turns when she turns on the spot (never a pivot-slide)
    const want = { idle: 0, walk: 0, run: 0, turnL: 0, turnR: 0 };
    const turning = Math.abs(inp.yawRate) > 0.6 && sp < 0.3;
    if (turning) { if (inp.yawRate > 0) want.turnL = 1; else want.turnR = 1; }
    else if (sp < 0.12) want.idle = 1;
    else want.walk = 1; // moving: the gait mix below picks walk / brisk walk / jog / run by speed
    for (const key of Object.keys(want) as (keyof typeof want)[]) this.loco[key] += (want[key] - this.loco[key]) * Math.min(1, dt * 7);
    const set = (n: string, w: number, rate = 1) => { const a = this.act(n); if (a) { a.setEffectiveWeight(w); a.setEffectiveTimeScale(rate); } };
    const e = this.energy;
    // stairs: a shorter, slower step cadence than flat walking for the same ground speed
    const stairRate = onStairs ? 1.25 : 1;
    // gait mix by (smoothed) speed between the clips' natural speeds; on stairs only the plain walk (one tread a step)
    {
      const G = this.gaits, w = G.map(() => 0);
      if (G.length) {
        const v = this.spS;
        if (onStairs) w[G.findIndex((g) => g.name === 'walk')] = 1;
        else if (v <= G[0].v0) w[0] = 1;
        else if (v >= G[G.length - 1].v0) w[G.length - 1] = 1;
        else {
          // walks blend with each other (same double-support timing), but a walk and a jog never hold a mix: half a
          // walk plus half a jog is neither (feet float through the flight phase and skate through double support).
          // (A short crossfade on the shared phase between them.)
          // (owner) she jogs only when asked to (a hard press), from 1.9 m/s; she drops back to a walk below 1.5 m/s,
          // or below 2.1 once the press eases
          const jog = G.findIndex((g) => g.name === 'jog');
          if (jog > 0) { if (!this.jogging && inp.jog && v > 1.9) this.jogging = true; else if (this.jogging && (v < 1.5 || (!inp.jog && v < 2.1))) this.jogging = false; }
          const top = jog > 0 ? jog - 1 : G.length - 1, bot = 0;
          if (this.jogging && jog > 0) { w[jog] = JOG_MIX; w[jog - 1] = 1 - JOG_MIX; }
          else if (v <= G[bot].v0) w[bot] = 1;
          else if (v >= G[top].v0) w[top] = 1;
          else for (let i = bot; i < top; i++) if (v >= G[i].v0 && v <= G[i + 1].v0) { const k = THREE.MathUtils.smoothstep(v, G[i].v0, G[i + 1].v0); w[i] = 1 - k; w[i + 1] = k; break; }
        }
        for (let i = 0; i < G.length; i++) { if (w[i] < 0) w[i] = 0; this.gaitW[i] = (this.gaitW[i] ?? 0) + (w[i] - (this.gaitW[i] ?? 0)) * Math.min(1, dt * 9); }
        const tot = this.gaitW.reduce((x, y) => x + y, 0) || 1;
        let cyc = 0;
        for (let i = 0; i < G.length; i++) cyc += (this.gaitW[i] / tot) * G[i].cyc;
        if (onStairs) cyc /= 1.45;
        // shared cycle: advance by the distance her root actually covered this frame (not the commanded speed: the
        // brain eases speed by heading error and lane corrections, and any mismatch shows as a sliding foot); a jump
        // (re-entry, camera carry) falls back to the commanded speed. A minimum cadence keeps a slow drift stepping.
        const moved = Math.hypot(this.rig.root.position.x - this.lastPos.x, this.rig.root.position.z - this.lastPos.z) / Math.max(dt, 1e-3);
        const spA = moved > 7 ? sp : moved;
        // stepping backwards (a few steps back when the visitor reverses, before she turns round): the shared cycle
        // runs in reverse, so the walk plays backwards and the feet still match the ground
        const fwd = this.herFwd();
        const along = ((this.rig.root.position.x - this.lastPos.x) * fwd.x + (this.rig.root.position.z - this.lastPos.z) * fwd.z) / Math.max(dt, 1e-3);
        const back = moved <= 7 && along < -0.1 && along < -0.5 * moved;
        // dancing as she walks: the cadence leans (up to 12 %) toward stepping on the beat (a step = half a cycle; her
        // brisk walk is ~2.1 steps/s, the music ~2.1 beats/s, so it locks with little change)
        let lock = 1;
        if (this.grooveW > 0.2 && inp.beat !== undefined && !back) {
          const e = ((inp.beat % 1) - ((this.gPhase * 2) % 1) + 1.5) % 1 - 0.5;
          lock = 1 + Math.max(-0.12, Math.min(0.12, e * 0.6)) * this.grooveW;
        }
        if (this.loco.walk > 0.01) this.gPhase = ((this.gPhase + (back ? -1 : 1) * lock * Math.max(spA, 0.25) * dt / Math.max(0.3, cyc)) % 1 + 1) % 1;
        for (let i = 0; i < G.length; i++) {
          const g = G[i];
          g.a.time = (g.t0 + this.gPhase * g.dur / g.n) % g.dur;
          g.a.setEffectiveWeight(this.loco.walk * this.gaitW[i] / tot);
        }
      }
      void e; void stairRate;
    }
    // turn clips turn ~90 degrees per cycle: match their stepping to her yaw rate
    const turnRate = THREE.MathUtils.clamp(Math.abs(inp.yawRate) / 1.6, 0.6, 1.6);
    set('turn_l', this.loco.turnL, turnRate);
    set('turn_r', this.loco.turnR, turnRate);
    // ---- gesture layer (standing): presenting is handled separately below
    let g = inp.gesture;
    if (g === 'none' && inp.talking && sp < 0.3) g = 'talk';
    const pointReq = g === 'point' && !!inp.pointAt && sp < 0.6;
    if (g === 'point') g = 'none';
    if (g !== this.gesture) {
      this.gesture = g;
      const opts = GESTURE_CLIP[g];
      const next = opts ? this.act(opts[Math.floor(Math.random() * opts.length)]) ?? null : null;
      if (next !== this.gestureAction) {
        if (this.prevGesture && this.prevGesture !== next) this.prevGesture.setEffectiveWeight(0);
        this.prevGesture = this.gestureAction;
        this.prevW = this.gestW;
        if (next) { next.reset(); next.play(); }
        this.gestureAction = next;
        this.gestW = 0;
      }
    }
    if (this.gestureAction) this.gestureAction.setEffectiveTimeScale(g === 'waveBig' ? 1.25 : g === 'dance' ? 1 + 0.15 * e : 1);
    const standK = Math.max(0, 1 - this.loco.walk - this.loco.run);
    this.gestW = Math.min(1, this.gestW + dt / 0.35);
    this.prevW = Math.max(0, this.prevW - dt / 0.35);
    const gW = this.gestureAction ? this.gestW * standK : 0;
    if (this.gestureAction) this.gestureAction.setEffectiveWeight(gW);
    if (this.prevGesture) { this.prevGesture.setEffectiveWeight(this.prevW * standK); if (this.prevW <= 0) { this.prevGesture.setEffectiveWeight(0); this.prevGesture = null; } }
    if (g === 'tada' && this.act('cheer') && !this.act('cheer')!.isRunning()) this.act('cheer')!.reset().play();
    // ---- presenting: which hand (the work's side, switching only when it has clearly moved over)
    if (pointReq) {
      const tw = this.vc.copy(inp.pointAt!).applyMatrix4(this.rig.root.matrixWorld).sub(this.rig.root.getWorldPosition(this.v));
      const sideDot = tw.setY(0).normalize().dot(this.herRight());
      const side = sideDot >= 0 ? 'Right' : 'Left';
      if (side !== this.pointSide && Math.abs(sideDot) > 0.35) this.sideFlipT += dt; else this.sideFlipT = 0;
      if (this.sideFlipT > 0.5 && this.pointW < 0.05) { this.pointSide = side; this.sideFlipT = 0; this.presentT = 0; }
      this.lastPointAt.copy(inp.pointAt!);
    }
    const presentOn = pointReq && this.sideFlipT <= 0.5;
    if (presentOn && !this.presenting) { this.presenting = true; this.presentSince = this.t; if (this.presentT > PRESENT.holdB) this.presentT = 0.25; }
    if (!presentOn && this.presenting) this.presenting = false;
    // clip time: open the arm, hold (gentle ping-pong inside the hold so it never freezes), then lower it
    if (this.presenting) {
      if (this.presentT < PRESENT.holdA) this.presentT = Math.min(PRESENT.holdA, this.presentT + dt * 1.15);
      else {
        this.presentT += dt * 0.22 * this.presentDir;
        if (this.presentT > PRESENT.holdB) { this.presentT = PRESENT.holdB; this.presentDir = -1; }
        if (this.presentT < PRESENT.holdA) { this.presentT = PRESENT.holdA; this.presentDir = 1; }
      }
    } else if (this.pointW > 0.001) {
      if (this.presentT < PRESENT.holdB) this.presentT = Math.max(this.presentT, PRESENT.holdB - 0.1);
      this.presentT = Math.min(PRESENT.end, this.presentT + dt * 1.4);
    }
    const reachK = smooth01(Math.min(1, this.presentT / PRESENT.reach));
    this.pointW += ((this.presenting ? 1 : 0) - this.pointW) * Math.min(1, dt * (this.presenting ? 4 : 2.2));
    if (!this.presenting && this.presentT >= PRESENT.end - 0.05) this.pointW = Math.max(0, this.pointW - dt * 3);
    const pw = this.pointW * standK;
    for (const n of ['talk_right', 'talk_left'] as const) {
      const a = this.act(n);
      if (!a) continue;
      const on = (n === 'talk_right') === (this.pointSide === 'Right');
      a.time = this.presentT;
      a.setEffectiveWeight(on ? pw : 0);
    }
    // idle fills whatever the other layers leave, so the weights always sum to 1 (any shortfall would blend toward
    // the bind A-pose: arms held out)
    const others = this.loco.walk + this.loco.run + this.loco.turnL + this.loco.turnR + gW + pw + this.prevW * standK;
    set('idle', Math.max(0, 1 - others));
    this.mixer.update(dt);
    // keep the stance foot of the stride clips on the floor (see groundOff)
    {
      const hips = this.rig.bones.Hips;
      const tot = this.gaitW.reduce((x, y) => x + y, 0) || 1;
      // the calm idle stands ~3 cm lower than the bind pose (soles below the floor): lift every pose by that much
      let off = Number.isFinite(this.bindFloor) ? this.groundRef - this.bindFloor : 0;
      this.gaits.forEach((g, i) => { off += this.loco.walk * (this.gaitW[i] / tot) * (g.floor - this.groundRef); });
      if (hips && hips.parent && Math.abs(off) > 1e-4) { const sc = hips.parent.getWorldScale(this.va).y || 1; hips.position.y -= off / sc; }
    }
    // ---- procedural layers (after the clips)
    this.rig.root.updateMatrixWorld(true);
    // a lighter, more feminine walk on top of the clip (before the plant, so the stance foot still holds)
    if (this.loco.walk > 0.01 && !onStairs && !this.noFem) this.feminineWalk(this.loco.walk * Math.min(1, sp / 0.5));
    if (this.grooveW > 0.01 && this.loco.walk > 0.01 && !onStairs) this.danceWalk(this.grooveW * this.loco.walk * (this.jogging ? 0.5 : 1), inp.beat ?? this.t * 128 / 60);
    // planted feet while walking or stepping round, stairs included (the plant holds the stance foot on its tread)
    this.plantFeet(dt, Math.min(1, this.loco.walk + this.loco.turnL + this.loco.turnR), onStairs);
    this.phase = this.gPhase;
    if (pw > 0.01) this.aimPresent(this.pointSide, this.lastPointAt, pw * reachK * 0.85);
    // (the hand wave is procedural, so it also plays while she walks: a hello to someone she passes)
    const wW = this.gesture === 'wave' ? Math.max(gW, this.gestW * 0.9) : gW;
    if ((this.gesture === 'waveBig' || this.gesture === 'wave') && wW > 0.01) this.bigWave(smooth01(wW));
    // (owner: "as she walks by people, have her slowly hover her hand past them, to get by politely") the hand on the
    // person's side rises a little, slowly (~0.7 s), drifts back past them, and lowers (~0.8 s); not while waving,
    // presenting, on the stairs, dancing or with that hand on a rail
    {
      const busy = wW > 0.05 || pw > 0.05 || onStairs || this.grooveW > 0.1 || this.skirtHold > 0.05 || this.passOff;
      const want = !busy && (inp.pass ?? 0) > 0.5 && !!inp.passAt && sp > 0.25;
      if (want && this.passW < 0.05) {
        // the side: where they are (her right / left), chosen as the hand starts to rise
        const tw = this.vc.copy(inp.passAt!).applyMatrix4(this.rig.root.matrixWorld).sub(this.rig.root.getWorldPosition(this.v));
        this.passSide = tw.setY(0).dot(this.herRight(this.vd)) >= 0 ? 'Right' : 'Left';
        this.passT = 0;
      }
      const railSame = this.railW > 0.05 && this.railSideNow === this.passSide;
      const on = want && !railSame;
      this.passW = Math.max(0, Math.min(1, this.passW + (on ? dt / 0.7 : -dt / (busy ? 0.3 : 0.8))));
      if (this.passW > 0) this.passT += dt;
      if (this.passW > 0.005) this.passHand(smooth01(this.passW), this.passSide, this.passT);
    }
    // stairs: skirt held at both sides, knees lifted; the hem rises in the shader
    this.skirtHold += ((onStairs && pw < 0.05 ? 1 : 0) - this.skirtHold) * Math.min(1, dt * 4);
    const hold = smooth01(this.skirtHold);
    if (hold > 0.01) { this.holdSkirt(hold); this.kneeLift(hold * Math.min(1, sp / 0.4)); }
    flowUniforms.uSkirtLift.value = hold;
    // a hand on the rail she's walking past (not on stairs, not while presenting)
    const railing = !!inp.railAt && pw < 0.05 && hold < 0.05;
    if (railing) { this.railLocal.copy(inp.railAt!); if (this.railW < 0.05) this.railSideNow = inp.railSide ?? 'Right'; }
    this.railW += ((railing ? 1 : 0) - this.railW) * Math.min(1, dt * 4);
    if (this.railW > 0.01) this.reach(this.railSideNow, this.railLocal, 0.85 * smooth01(this.railW), 0.3);
    // head: a guide glances at the work, then back at you; otherwise she looks at the visitor
    const B = this.rig.bones;
    let look: THREE.Vector3 | undefined = inp.lookAt;
    if (this.presenting) {
      const since = this.t - this.presentSince;
      // POSTURE §1: glance at the work on the stroke (~0.6 s), then talk to the visitor, re-glancing every ~3 s
      const atWork = since < 0.7 || (since % 3.2) > 2.65;
      if (atWork) look = this.lastPointAt;
    }
    let wantYaw = 0;
    if (look && B.Head) {
      const head = B.Head;
      const hp = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
      const tgt = this.v.copy(look).applyMatrix4(this.rig.root.matrixWorld).sub(hp);
      const local = tgt.applyQuaternion(this.rig.root.getWorldQuaternion(this.q).invert());
      wantYaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.0, 1.0);
    }
    // turns start at the head (POSTURE §8): look into the turn ahead of the body
    if (!this.presenting) wantYaw = THREE.MathUtils.clamp(wantYaw * (1 - Math.min(1, Math.abs(inp.yawRate) / 1.2)) + inp.yawRate * 0.35, -1, 1);
    this.lookYaw += (wantYaw - this.lookYaw) * Math.min(1, dt * 6);
    if (B.Head && Math.abs(this.lookYaw) > 1e-3) {
      // split between neck and head, about the world vertical (axis-agnostic)
      const up = this.vb.set(0, 1, 0);
      if (B.neck) this.rotateWorld(B.neck, this.qa.setFromAxisAngle(up, this.lookYaw * 0.3), 1);
      this.rotateWorld(B.Head, this.qa.setFromAxisAngle(up, this.lookYaw * 0.35), 1);
    }
    // flow uniforms: velocity in model space
    const p = this.rig.root.position;
    const vel = this.v.copy(p).sub(this.lastPos).divideScalar(Math.max(dt, 1e-3));
    this.lastPos.copy(p);
    vel.applyQuaternion(this.rig.root.getWorldQuaternion(this.q).invert());
    const fv = flowUniforms.uFlowVel.value;
    fv.lerp(vel.clampLength(0, 4), Math.min(1, dt * 6));
    if ((flowUniforms as any).off) fv.set(0, 0, 0);
    flowUniforms.uFlowT.value = this.t;
    flowUniforms.uFlowPhase.value = this.phase;
  }
}
