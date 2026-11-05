import * as THREE from 'three';
import { Face } from './face';
import { flat, outlineMaterial, toon } from './materials';

export type BoneName =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'upperArmL' | 'forearmL' | 'handL'
  | 'shoulderR' | 'upperArmR' | 'forearmR' | 'handR'
  | 'thighL' | 'shinL' | 'footL' | 'thighR' | 'shinR' | 'footR';

export const LEG = { thigh: 0.4, shin: 0.38, ankle: 0.06, hipY: 0.84, hipX: 0.08 };

const WHITE = 0xf3f1ec;
const INK = 0x131118;
const SKIN = 0xf4ddcf;

export interface GuideRig {
  root: THREE.Group;
  bones: Record<BoneName, THREE.Object3D>;
  face: Face;
  skirt: { geo: THREE.BufferGeometry; base: Float32Array; meta: Float32Array };
  headCenter: THREE.Object3D;
  contact: THREE.Mesh;
  pool: THREE.Mesh;
}

function addOutlined(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, outline = 1) {
  const m = new THREE.Mesh(geo, mat);
  parent.add(m);
  if (outline > 0) {
    const o = new THREE.Mesh(geo, outlineMaterial(outline));
    o.renderOrder = -1;
    m.add(o);
  }
  m.renderOrder = 1;
  return m;
}

/** Pointed manga chin + slightly narrower jaw, applied to any sphere-ish head geometry. */
function sculptHead(geo: THREE.BufferGeometry, r: number) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const below = Math.max(0, -y / r);
    if (y < 0) y *= 0.74; // shorter lower face
    x *= 1 - 0.2 * Math.pow(below, 1.6);
    if (z > 0) {
      y -= 0.12 * r * Math.pow(below, 2) * (z / r);
      z *= 1 - 0.1 * below;
    }
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
}

function hairGeometry() {
  const pts = [
    [0.001, 0.142], [0.05, 0.138], [0.094, 0.121], [0.124, 0.088], [0.139, 0.046], [0.143, 0.0],
    [0.14, -0.04], [0.133, -0.07], [0.131, -0.086], [0.14, -0.102], [0.166, -0.118], [0.198, -0.13],
    [0.212, -0.134], [0.204, -0.141], [0.168, -0.136], [0.13, -0.114],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 64);
  return g;
}

function hairMaterial() {
  const m = toon(0x121017, { side: THREE.DoubleSide }, false, 0.15);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev(s, r);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairLocal = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairLocal;')
      .replace(
        'void main() {',
        `void main() {
          float ang = atan(vHairLocal.x, vHairLocal.z);
          // Face window: blunt bangs at y=0.042, cheeks framed by the bob down to the jaw.
          float halfW = mix(0.86, 0.68, clamp((0.03 - vHairLocal.y) / 0.16, 0.0, 1.0));
          if (vHairLocal.z > 0.0 && vHairLocal.y < 0.03 && vHairLocal.y > -0.2 && abs(ang) < halfW) discard;`,
      );
  };
  m.customProgramCacheKey = () => 'hair2';
  return m;
}

function hairMaterialPlain() {
  return toon(0x121017, { side: THREE.DoubleSide }, false, 0.15);
}

function hairOutlineMaterial() {
  const m = outlineMaterial(1).clone();
  m.onBeforeCompile = (s, r) => {
    outlineMaterial(1).onBeforeCompile(s, r);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairLocal = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairLocal;')
      .replace(
        'void main() {',
        `void main() {
          float ang = atan(vHairLocal.x, vHairLocal.z);
          float halfW = mix(0.86, 0.68, clamp((0.03 - vHairLocal.y) / 0.16, 0.0, 1.0));
          if (vHairLocal.z > 0.0 && vHairLocal.y < 0.02 && vHairLocal.y > -0.2 && abs(ang) < halfW - 0.06) discard;`,
      );
  };
  m.customProgramCacheKey = () => 'hairOutline';
  return m;
}

/** Knife-pleated A-line skirt: alternating black and white facets, deformable per frame. */
function skirtGeometry() {
  const N = 26; // pleats
  const F = N * 2; // facets
  const R = 10; // rings
  const top = 0.085, hem = -0.56;
  const verts: number[] = [];
  const cols: number[] = [];
  const meta: number[] = []; // per-vertex: angle, t (0 waist..1 hem)
  const w = new THREE.Color(WHITE), k = new THREE.Color(INK);
  const pos = (ang: number, t: number, outer: boolean) => {
    const r0 = 0.104 + (0.205 - 0.104) * Math.pow(t, 0.9) + 0.06 * t * t;
    const a = 0.055 * Math.pow(t, 0.8);
    const r = r0 * (outer ? 1 + a : 1 - a);
    return [Math.sin(ang) * r * 1.0, top + (hem - top) * t, Math.cos(ang) * r * 0.86];
  };
  for (let f = 0; f < F; f++) {
    const a0 = (f / F) * Math.PI * 2, a1 = ((f + 1) / F) * Math.PI * 2;
    const o0 = f % 2 === 0, o1 = !o0;
    // Every pleat is one white and one black facet, so the skirt reads as vertical stripes.
    const c = Math.floor(f / 1) % 2 === 0 ? w : k;
    for (let j = 0; j < R; j++) {
      const t0 = j / R, t1 = (j + 1) / R;
      const A = pos(a0, t0, o0), B = pos(a1, t0, o1), C = pos(a1, t1, o1), D = pos(a0, t1, o0);
      // outward winding (so the ink hull sits behind the skirt, not in front of it)
      const quad = [A, C, B, A, D, C];
      const qm = [[a0, t0], [a1, t1], [a1, t0], [a0, t0], [a0, t1], [a1, t1]];
      quad.forEach((v, i) => {
        verts.push(...v);
        cols.push(c.r, c.g, c.b);
        meta.push(qm[i][0], qm[i][1]);
      });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return { geo: g, base: new Float32Array(verts), meta: new Float32Array(meta) };
}

export function buildGuide(): GuideRig {
  const root = new THREE.Group();
  root.name = 'HermesGuide';
  const B = {} as Record<BoneName, THREE.Object3D>;
  const bone = (name: BoneName, parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const o = new THREE.Bone();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    B[name] = o;
    return o;
  };
  bone('hips', root, 0, 0.9);
  bone('spine', B.hips, 0, 0.06);
  bone('chest', B.spine, 0, 0.16);
  bone('neck', B.chest, 0, 0.19);
  bone('head', B.neck, 0, 0.042);
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    bone(`shoulder${s}`, B.chest, 0.128 * sx, 0.145);
    bone(`upperArm${s}`, B[`shoulder${s}`], 0.01 * sx, 0);
    bone(`forearm${s}`, B[`upperArm${s}`], 0, -0.24);
    bone(`hand${s}`, B[`forearm${s}`], 0, -0.22);
    bone(`thigh${s}`, B.hips, LEG.hipX * sx, LEG.hipY - 0.9);
    bone(`shin${s}`, B[`thigh${s}`], 0, -LEG.thigh);
    bone(`foot${s}`, B[`shin${s}`], 0, -LEG.shin);
  }

  const white = toon(WHITE);
  const ink = toon(INK, { color: 0x1b1822 }, false);
  const skin = toon(SKIN, {}, false);
  const glossBlack = toon(0x0d0b10, {}, false);

  // Head
  const headGeo = new THREE.SphereGeometry(0.1, 40, 28);
  headGeo.scale(0.94, 1.06, 0.98);
  sculptHead(headGeo, 0.1);
  const headCenter = new THREE.Object3D();
  headCenter.position.set(0, 0.118, 0.008);
  headCenter.scale.setScalar(1.27); // manga proportions: big head, ~6 heads tall
  B.head.add(headCenter);
  addOutlined(headCenter, headGeo, skin, 1);
  const face = new Face();
  const faceGeo = new THREE.SphereGeometry(0.1012, 40, 28, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.8, 1.55);
  faceGeo.scale(0.94, 1.06, 0.98);
  sculptHead(faceGeo, 0.1);
  const faceMat = flat(0xffffff, { map: face.texture, transparent: true, alphaTest: 0.05, depthWrite: false });
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.renderOrder = 2;
  headCenter.add(faceMesh);
  // Hair: glossy black bob, blunt bangs, flipped ends
  const hairGeo = hairGeometry();
  const hair = new THREE.Mesh(hairGeo, hairMaterial());
  hair.position.set(0, -0.003, -0.004);
  hair.renderOrder = 3;
  const hairO = new THREE.Mesh(hairGeo, hairOutlineMaterial());
  hairO.renderOrder = -1;
  hair.add(hairO);
  headCenter.add(hair);
  // Manga hair shine: short white arcs on the crown
  for (const [a, y, r, len] of [[Math.PI / 2 + 0.5, 0.09, 0.116, 0.42], [Math.PI / 2 - 0.55, 0.086, 0.118, 0.34]] as const) {
    const s = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.0085, 4, 20, len), flat(0xffffff));
    s.rotation.x = Math.PI / 2;
    s.rotation.z = a - len / 2;
    s.position.y = y;
    s.scale.set(1, 1, 1);
    hair.add(s);
  }
  // White headband over the crown, ear to ear
  const bandGeo = new THREE.TorusGeometry(0.142, 0.0078, 8, 64, Math.PI * 0.8);
  bandGeo.rotateZ(Math.PI * 0.1); // ends tuck into the hair above the ears
  bandGeo.scale(1.0, 1.05, 1.04);
  const band = addOutlined(headCenter, bandGeo, white, 0.55);
  band.rotation.x = 0.22; // tipped forward so it reads across the crown above the bangs
  band.position.set(0, 0.0, -0.004);
  // Blunt bangs: a separate slab across the forehead with a crisp straight edge
  const bangGeo = new THREE.CylinderGeometry(0.11, 0.141, 0.082, 40, 2, true, -0.9, 1.8);
  const bangs = new THREE.Mesh(bangGeo, hairMaterialPlain());
  bangs.position.set(0, 0.068, 0.006);
  bangs.renderOrder = 3;
  headCenter.add(bangs);

  // Neck + torso (double-breasted chef top with mandarin collar)
  addOutlined(B.neck, new THREE.CylinderGeometry(0.03, 0.034, 0.07, 16), skin, 0.8).position.y = 0.02;
  const torsoPts = [
    [0.1, -0.03], [0.101, 0.02], [0.11, 0.09], [0.123, 0.16], [0.129, 0.21], [0.128, 0.26], [0.118, 0.3],
    [0.092, 0.33], [0.05, 0.345], [0.0, 0.347],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const torsoGeo = new THREE.LatheGeometry(torsoPts, 40);
  torsoGeo.scale(1, 1, 0.74);
  addOutlined(B.spine, torsoGeo, white, 1);
  const collar = addOutlined(B.spine, new THREE.CylinderGeometry(0.05, 0.056, 0.055, 28, 1, true, 0.32, Math.PI * 2 - 0.64), white, 0.7);
  collar.position.y = 0.355;
  (collar.material as THREE.Material).side = THREE.DoubleSide;
  // Front panel edge + two columns of black buttons
  const frontZ = (y: number) => {
    let r = 0.1;
    for (let i = 0; i < torsoPts.length - 1; i++) {
      const a = torsoPts[i], b = torsoPts[i + 1];
      if (y >= a.y && y <= b.y) r = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
    }
    return r * 0.74;
  };
  const curve = new THREE.CatmullRomCurve3(
    [0.33, 0.27, 0.2, 0.12, 0.04, -0.02].map((y, i) => new THREE.Vector3(-0.018 - i * 0.006, y, frontZ(y) - 0.012 * (1 - Math.abs(-0.018 - i * 0.006) / 0.12) + 0.004)),
  );
  B.spine.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0022, 4), flat(INK)));
  const btnGeo = new THREE.SphereGeometry(0.0095, 10, 8);
  btnGeo.scale(1, 1, 0.55);
  for (const x of [-0.045, 0.04]) {
    for (const y of [0.07, 0.13, 0.19, 0.25]) {
      const b = new THREE.Mesh(btnGeo, flat(0x08070b));
      const z = Math.sqrt(Math.max(0, frontZ(y) ** 2 - (x * 0.74) ** 2)) + 0.003;
      b.position.set(x, y, z);
      B.spine.add(b);
    }
  }
  // Waistband
  addOutlined(B.spine, new THREE.CylinderGeometry(0.103, 0.102, 0.034, 32), white, 0.8).position.y = 0.03;
  B.spine.children[B.spine.children.length - 1].scale.z = 0.8;

  // Skirt
  const sk = skirtGeometry();
  const skirtMat = toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
  addOutlined(B.hips, sk.geo, skirtMat, 1.1);

  // Arms
  for (const s of ['L', 'R'] as const) {
    addOutlined(B[`shoulder${s}`], new THREE.SphereGeometry(0.052, 16, 12), white, 0.9).scale.set(0.82, 0.74, 0.76);
    const sleeve = addOutlined(B[`upperArm${s}`], new THREE.CylinderGeometry(0.05, 0.057, 0.105, 20), white, 0.9);
    sleeve.position.y = -0.04;
    sleeve.scale.z = 0.9;
    const cuff = addOutlined(B[`upperArm${s}`], new THREE.CylinderGeometry(0.06, 0.06, 0.022, 20), white, 0.7);
    cuff.position.y = -0.088;
    cuff.scale.z = 0.9;
    // hand: palm + four fingers + thumb (no mitts)
    const palmGeo = new THREE.BoxGeometry(0.05, 0.05, 0.022, 2, 2, 1);
    const palm = addOutlined(B[`hand${s}`], palmGeo, skin, 0.6);
    palm.position.y = -0.03;
    for (let k = 0; k < 4; k++) {
      const fg = addOutlined(B[`hand${s}`], new THREE.CapsuleGeometry(0.0062, 0.026 - Math.abs(k - 1.5) * 0.004, 3, 6), skin, 0.45);
      fg.position.set((k - 1.5) * 0.0125, -0.07, 0.002);
      fg.rotation.x = 0.25;
    }
    const thumb = addOutlined(B[`hand${s}`], new THREE.CapsuleGeometry(0.0068, 0.022, 3, 6), skin, 0.45);
    thumb.position.set(0.0, -0.035, 0.018);
    thumb.rotation.set(0.7, 0, 0);
  }

  root.updateMatrixWorld(true);
  for (const s of ['L', 'R'] as const) {
    const ua = B[`upperArm${s}`] as THREE.Bone, fa = B[`forearm${s}`] as THREE.Bone, hd = B[`hand${s}`] as THREE.Bone;
    const L = 0.46, seg = 18;
    const geo = new THREE.CylinderGeometry(0.031, 0.021, L, 16, seg, false);
    geo.translate(0, -L / 2, 0);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const idx: number[] = [], wts: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const t = -pos.getY(i) / L;
      // slight elbow pinch + forearm swell, like the drawing
      const r = 1 - 0.1 * Math.exp(-(((t - 0.52) / 0.06) ** 2)) + 0.06 * Math.exp(-(((t - 0.65) / 0.08) ** 2));
      pos.setX(i, pos.getX(i) * r);
      pos.setZ(i, pos.getZ(i) * r * 0.92);
      const w = THREE.MathUtils.smoothstep(t, 0.44, 0.6);
      const wh = THREE.MathUtils.smoothstep(t, 0.93, 1.0);
      idx.push(0, 1, 2, 0);
      wts.push(1 - w, w - wh, wh, 0);
    }
    geo.computeVertexNormals();
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    const start = new THREE.Vector3();
    ua.getWorldPosition(start);
    geo.translate(start.x, start.y, start.z);
    const skel = new THREE.Skeleton([ua, fa, hd]);
    const arm = new THREE.SkinnedMesh(geo, skin);
    arm.frustumCulled = false;
    root.add(arm);
    arm.bind(skel);
    const armO = new THREE.SkinnedMesh(geo, outlineMaterial(0.8));
    armO.frustumCulled = false;
    armO.renderOrder = -1;
    root.add(armO);
    armO.bind(skel, arm.bindMatrix);
  }

  // Legs: black tights, Mary Jane flats
  for (const s of ['L', 'R'] as const) {
    addOutlined(B[`thigh${s}`], new THREE.CylinderGeometry(0.058, 0.045, LEG.thigh, 14), ink, 0.8).position.y = -LEG.thigh / 2;
    addOutlined(B[`shin${s}`], new THREE.SphereGeometry(0.044, 12, 10), ink, 0.6);
    addOutlined(B[`shin${s}`], new THREE.CylinderGeometry(0.043, 0.028, LEG.shin, 14), ink, 0.8).position.y = -LEG.shin / 2;
    const shoeGeo = new THREE.SphereGeometry(1, 20, 14);
    shoeGeo.scale(0.041, 0.03, 0.1);
    const shoe = addOutlined(B[`foot${s}`], shoeGeo, glossBlack, 0.8);
    shoe.position.set(0, -LEG.ankle + 0.026, 0.045);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0055, 6, 16, Math.PI), flat(0x050407));
    strap.rotation.y = Math.PI / 2;
    strap.position.set(0, -LEG.ankle + 0.03, 0.035);
    B[`foot${s}`].add(strap);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), flat(0xffffff));
    shine.scale.set(1.6, 0.5, 1);
    shine.position.set(0.012, -LEG.ankle + 0.052, 0.09);
    B[`foot${s}`].add(shine);
  }

  // Soft contact shadow on the floor
  const cs = document.createElement('canvas');
  cs.width = cs.height = 128;
  const cx = cs.getContext('2d')!;
  const g = cx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.92)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(cs);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.62),
    flat(0x000000, { map: shadowTex, transparent: true, depthWrite: false, opacity: 0.95 }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.004;
  contact.renderOrder = 0;
  root.add(contact);

  // teal light pool for the dark passage (the orb's glow on the floor)
  const pc = document.createElement('canvas');
  pc.width = pc.height = 128;
  const px = pc.getContext('2d')!;
  const pg = px.createRadialGradient(64, 64, 2, 64, 64, 62);
  pg.addColorStop(0, 'rgba(90,255,220,0.9)');
  pg.addColorStop(0.5, 'rgba(40,200,180,0.35)');
  pg.addColorStop(1, 'rgba(0,0,0,0)');
  px.fillStyle = pg;
  px.fillRect(0, 0, 128, 128);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.003;
  pool.visible = false;
  root.add(pool);
  return { root, bones: B, face, skirt: sk, headCenter, contact, pool };
}
