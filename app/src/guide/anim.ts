import * as THREE from 'three';
import type { Eyes, Mouth } from './face';
import { type BoneName, type GuideRig, LEG } from './model';

export type Gesture =
  | 'none' | 'wave' | 'point' | 'beckon' | 'tada' | 'talk' | 'lookBack'
  | 'fidgetHeadband' | 'lookAround' | 'handOnHip' | 'tapFoot' | 'dance' | 'waveBig';

type Pose = Partial<Record<BoneName, [number, number, number]>>;

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Gait parameters. Foot-lock holds because phase advances by distance * duty / stride. */
const GAITS = [
  { speed: 0.0, S: 0.36, duty: 0.6, lift: 0.07, bob: 0.01, lean: 0.02, arm: 0.25, elbow: 0.25 }, // stroll
  { speed: 1.2, S: 0.44, duty: 0.56, lift: 0.08, bob: 0.014, lean: 0.05, arm: 0.42, elbow: 0.35 }, // walk
  { speed: 2.4, S: 0.52, duty: 0.42, lift: 0.13, bob: 0.03, lean: 0.14, arm: 0.6, elbow: 1.2 }, // jog
  { speed: 4.0, S: 0.62, duty: 0.34, lift: 0.18, bob: 0.04, lean: 0.24, arm: 0.8, elbow: 1.5 }, // run
];

function gaitAt(v: number) {
  let a = GAITS[0], b = GAITS[GAITS.length - 1];
  for (let i = 0; i < GAITS.length - 1; i++) {
    if (v >= GAITS[i].speed && v <= GAITS[i + 1].speed) { a = GAITS[i]; b = GAITS[i + 1]; break; }
  }
  const t = b.speed === a.speed ? 0 : THREE.MathUtils.clamp((v - a.speed) / (b.speed - a.speed), 0, 1);
  const out: Record<string, number> = {};
  for (const k of Object.keys(a)) out[k] = lerp((a as never)[k], (b as never)[k], t);
  return out as typeof GAITS[0];
}

export interface AnimInput {
  dt: number;
  speed: number; // m/s along facing direction (root motion measured by the brain)
  yawRate: number; // rad/s
  slope: number; // floor rise per metre forward (stairs)
  gesture: Gesture;
  pointAt?: THREE.Vector3; // in root-local coordinates
  lookAt?: THREE.Vector3; // in root-local coordinates
  hop: boolean;
  talking: boolean;
  mood: 'neutral' | 'happy' | 'surprised';
  energy?: number; // 0 = normal, 1 = party (bouncier walk, sprints, dances)
  railAt?: THREE.Vector3; // root-local hand target on a rail she's walking past
  railSide?: 'Left' | 'Right';
  stairs?: boolean; // on measured stair treads (from the nav map): she holds her skirt
  jog?: boolean; // (owner: a hard press on the walk pad) she may break into a light jog
  groove?: number; // (owner: the dance room) 0..1 dancing as she walks
  beat?: number; // music beat clock: integer = on the beat (the upstairs track's tracked beats while it plays)
  // (owner: "as she walks by people, have her slowly hover her hand past them, to get by politely") 1 while she is
  // passing close to someone (the hand on their side rises a little, palm down / out), 0 otherwise; passAt = that
  // person (root-local), which picks the hand
  pass?: number;
  passAt?: THREE.Vector3;
}

export class GuideAnimator {
  phase = 0;
  t = 0;
  private gw: Partial<Record<Gesture, number>> = {};
  private loco = 0;
  private hopT = -1;
  private blinkT = 2;
  private mouthT = 0;
  private stepPhase = 0;
  private rest = new Map<THREE.Object3D, THREE.Vector3>();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private m = new THREE.Matrix4();
  footContact = { L: true, R: true };
  lastFeet = { L: new THREE.Vector3(), R: new THREE.Vector3() };

  constructor(public rig: GuideRig) {
    for (const b of Object.values(rig.bones)) this.rest.set(b, b.position.clone());
    for (const b of Object.values(rig.bones)) b.rotation.order = 'ZXY';
  }

  update(inp: AnimInput) {
    const { dt } = inp;
    this.t += dt;
    const B = this.rig.bones;
    const speed = Math.max(0, inp.speed);
    const turning = Math.abs(inp.yawRate) > 0.6 && speed < 0.25;
    this.loco = damp(this.loco, speed > 0.08 || turning ? 1 : 0, 6, dt);
    const g = gaitAt(speed);

    // --- phase: distance-driven so planted feet never slide
    if (speed > 0.02) this.phase = (this.phase + (speed * dt * g.duty) / g.S) % 1;
    if (turning) this.stepPhase = (this.stepPhase + Math.abs(inp.yawRate) * dt * 0.55) % 1;

    // the illustrated rig has no dance / big-wave poses: use its closest ones
    if (inp.gesture === 'dance') inp = { ...inp, gesture: 'tada' };
    else if (inp.gesture === 'waveBig') inp = { ...inp, gesture: 'wave' };
    // --- gesture weights (crossfade)
    for (const k of Object.keys(this.gw) as Gesture[]) if (k !== inp.gesture) this.gw[k] = damp(this.gw[k]!, 0, 7, dt);
    this.gw[inp.gesture] = damp(this.gw[inp.gesture] ?? 0, 1, 7, dt);

    // --- hop
    if (inp.hop && this.hopT < 0) this.hopT = 0;
    let hopY = 0, crouch = 0;
    if (this.hopT >= 0) {
      this.hopT += dt;
      const u = this.hopT;
      if (u < 0.12) crouch = smooth(u / 0.12) * 0.07;
      else if (u < 0.52) { hopY = Math.sin(((u - 0.12) / 0.4) * Math.PI) * 0.2; crouch = 0; }
      else if (u < 0.66) crouch = (1 - smooth((u - 0.52) / 0.14)) * 0.06;
      else this.hopT = -1;
    }

    // --- base pose: idle breathing blended with locomotion
    const breathe = Math.sin(this.t * 1.7);
    const sway = Math.sin(this.t * 0.6);
    const ph = this.phase * Math.PI * 2;
    const L = this.loco;
    const hipsY = 0.875 - g.bob * L * (0.5 + 0.5 * Math.cos(ph * 2)) - crouch + 0.003 * breathe * (1 - L) + hopY
      - (g.duty < 0.5 ? 0.025 * L : 0);
    B.hips.position.set(0.012 * sway * (1 - L), hipsY, 0);
    const pose: Pose = {
      hips: [0, 0.06 * Math.sin(ph) * L, (0.02 * sway * (1 - L)) + 0.03 * Math.sin(ph) * L],
      spine: [0.03 + g.lean * L + 0.01 * breathe, -0.05 * Math.sin(ph) * L, -0.01 * sway * (1 - L)],
      chest: [0.01 * breathe, -0.06 * Math.sin(ph) * L, 0],
      neck: [-0.02 - 0.4 * g.lean * L, 0.04 * Math.sin(ph) * L, 0],
      head: [-0.02 - 0.3 * g.lean * L, 0.05 * Math.sin(ph) * L, 0.025 * sway * (1 - L)],
      shoulderL: [0, 0, 0], shoulderR: [0, 0, 0],
      upperArmL: [g.arm * L * Math.cos(ph) + 0.02 * breathe, 0, 0.13 + 0.06 * L],
      upperArmR: [-g.arm * L * Math.cos(ph) + 0.02 * breathe, 0, -0.13 - 0.06 * L],
      forearmL: [-(0.15 + g.elbow * L) - 0.1 * L * Math.max(0, -Math.cos(ph)), 0, 0],
      forearmR: [-(0.15 + g.elbow * L) - 0.1 * L * Math.max(0, Math.cos(ph)), 0, 0],
      handL: [0, 0.2, 0.1], handR: [0, -0.2, -0.1],
    };

    // --- upper-body gestures
    const T = this.t;
    const gp = (k: Gesture) => this.gw[k] ?? 0;
    const layer = (w: number, p: Pose) => {
      if (w < 0.001) return;
      for (const [bn, r] of Object.entries(p) as [BoneName, [number, number, number]][]) {
        const base = pose[bn] ?? [0, 0, 0];
        pose[bn] = [lerp(base[0], r[0], w), lerp(base[1], r[1], w), lerp(base[2], r[2], w)];
      }
    };
    layer(gp('wave'), {
      upperArmR: [-0.12, 0, -2.45], forearmR: [0, 0, 0.1 + 0.42 * Math.sin(T * 9)],
      handR: [0, 0, 0.15 * Math.sin(T * 9 + 0.5)], head: [-0.05, 0.08, 0.12], neck: [0, 0.06, 0.05],
    });
    layer(gp('beckon'), {
      upperArmR: [-0.95, 0.35, -0.35], forearmR: [-0.75 - 0.75 * (0.5 + 0.5 * Math.sin(T * 7)), -0.4, 0],
      handR: [-0.5 - 0.4 * (0.5 + 0.5 * Math.sin(T * 7 - 0.5)), 0, 0], head: [0.02, 0.1, 0.12],
    });
    layer(gp('tada'), {
      upperArmL: [-0.35, 0, 2.15], upperArmR: [-0.35, 0, -2.15], forearmL: [-0.2, 0, 0.35], forearmR: [-0.2, 0, -0.35],
      handL: [0, 0, 0.3], handR: [0, 0, -0.3], head: [-0.12, 0, 0], spine: [-0.06, 0, 0], chest: [-0.06, 0, 0],
    });
    layer(gp('talk'), {
      upperArmR: [-0.4, 0, -0.32], forearmR: [-1.25 + 0.25 * Math.sin(T * 3.1), -0.3 + 0.2 * Math.sin(T * 2.3), 0],
      handR: [0.2 * Math.sin(T * 4.2), 0, 0], upperArmL: [-0.15, 0, 0.22], forearmL: [-0.55 + 0.15 * Math.sin(T * 2.6 + 1), 0, 0],
      head: [0.02 * Math.sin(T * 2.4), 0.08 * Math.sin(T * 1.3), 0.06 * Math.sin(T * 1.7)],
    });
    layer(gp('lookBack'), { chest: [0, 0.42, 0], neck: [0, 0.35, 0], head: [-0.05, 0.45, 0.08], spine: [0.03, 0.18, 0] });
    layer(gp('fidgetHeadband'), {
      upperArmR: [-1.0, 0.3, -1.65], forearmR: [-2.05, 0.2, 0], handR: [0.4, 0, 0], head: [0.05, -0.1, -0.12 + 0.04 * Math.sin(T * 5)],
    });
    layer(gp('lookAround'), { head: [-0.04, 0.55 * Math.sin(T * 0.9), 0.05 * Math.sin(T * 0.9)], neck: [0, 0.25 * Math.sin(T * 0.9), 0] });
    layer(gp('handOnHip'), {
      upperArmL: [0.25, 0, 0.75], forearmL: [-1.7, 0.6, 0], handL: [0, 0.5, 0.4], hips: [0, 0, -0.07],
      spine: [0.02, 0, 0.05], head: [0, 0, 0.12],
    });
    layer(gp('tapFoot'), { head: [0, 0.06, 0.08 + 0.03 * Math.sin(T * 8)], upperArmL: [0.15, 0, 0.35], upperArmR: [0.15, 0, -0.35] });

    // --- apply rotations (base + gestures), then aim layers
    for (const [bn, r] of Object.entries(pose) as [BoneName, [number, number, number]][]) B[bn].rotation.set(r[0], r[1], r[2]);
    B.hips.updateMatrixWorld(true);

    const wp = gp('point');
    if (wp > 0.001 && inp.pointAt) {
      // Aim the arm on the target's side; the other arm relaxes.
      const side = inp.pointAt.x >= 0 ? 'L' : 'R';
      const sh = B[`shoulder${side}`];
      sh.updateMatrixWorld(true);
      this.m.copy(sh.matrixWorld).invert();
      const rootM = this.rig.root.matrixWorld;
      const target = this.v.copy(inp.pointAt).applyMatrix4(rootM).applyMatrix4(this.m).normalize();
      this.q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target);
      const ua = B[`upperArm${side}`];
      this.q2.copy(ua.quaternion).slerp(this.q, wp);
      ua.quaternion.copy(this.q2);
      B[`forearm${side}`].rotation.set(lerp(B[`forearm${side}`].rotation.x, -0.08, wp), 0, 0);
      B[`hand${side}`].rotation.set(lerp(B[`hand${side}`].rotation.x, -0.2, wp), 0, 0);
    }
    if (inp.lookAt) {
      const head = B.head;
      head.parent!.updateMatrixWorld(true);
      this.m.copy(head.parent!.matrixWorld).invert();
      const tgt = this.v.copy(inp.lookAt).applyMatrix4(this.rig.root.matrixWorld).applyMatrix4(this.m);
      tgt.sub(head.position).normalize();
      const yaw = THREE.MathUtils.clamp(Math.atan2(tgt.x, tgt.z), -1.0, 1.0);
      const pitch = THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(tgt.y, -1, 1)), -0.4, 0.4);
      const w = 0.85 * (1 - gp('lookAround'));
      head.rotation.y = lerp(head.rotation.y, yaw * 0.7, w);
      head.rotation.x = lerp(head.rotation.x, pitch * 0.7, w);
      B.neck.rotation.y = lerp(B.neck.rotation.y, yaw * 0.3, w);
      this.rig.face.lookX = THREE.MathUtils.clamp(yaw * 1.2, -1, 1);
      this.rig.face.lookY = THREE.MathUtils.clamp(-pitch * 1.5, -1, 1);
    }

    // --- legs: IK to procedural foot targets in root space
    this.rig.root.updateMatrixWorld(true);
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      let p = (this.phase + (side === 'R' ? 0.5 : 0)) % 1;
      let fx = 0.085 * sx, fy = 0, fz = 0;
      // idle stance: weight shift + hand-on-hip knee pop
      const hip = gp('handOnHip');
      fz += (side === 'R' ? 0.06 : -0.02) * hip;
      fx += (side === 'R' ? -0.02 : 0.01) * hip;
      if (gp('tapFoot') > 0.5 && side === 'R') { fz += 0.08; fy += Math.max(0, Math.sin(T * 8)) * 0.025; }
      let contact = true;
      if (L > 0.001) {
        let lz: number, ly = 0;
        const S = turning && speed < 0.25 ? 0.06 : g.S;
        const duty = turning && speed < 0.25 ? 0.5 : g.duty;
        if (turning && speed < 0.25) p = (this.stepPhase + (side === 'R' ? 0.5 : 0)) % 1;
        if (p < duty) {
          lz = S / 2 - S * (p / duty);
        } else {
          const u = (p - duty) / (1 - duty);
          lz = -S / 2 + S * smooth(u);
          ly = Math.sin(u * Math.PI) * (turning && speed < 0.25 ? 0.05 : g.lift) * (1 + inp.slope * 1.5);
          contact = false;
        }
        fz = lerp(fz, lz, L);
        fy = lerp(fy, ly + inp.slope * lz, L);
      }
      this.footContact[side] = contact;
      this.solveLeg(side, new THREE.Vector3(fx, fy + LEG.ankle, fz), p, L, contact, g.duty);
    }

    // --- expressions
    this.blinkT -= dt;
    let eyes: Eyes = 'open';
    let mouth: Mouth = 'smile';
    if (inp.mood === 'happy' || gp('tada') > 0.5 || gp('wave') > 0.5) { eyes = 'happy'; mouth = 'grin'; }
    if (inp.mood === 'surprised') { eyes = 'wide'; mouth = 'o'; }
    if (this.blinkT < 0) { eyes = eyes === 'happy' ? eyes : 'closed'; if (this.blinkT < -0.12) this.blinkT = 2.2 + Math.random() * 3; }
    if (inp.talking) {
      this.mouthT += dt;
      mouth = Math.sin(this.mouthT * 18) > 0 ? 'open' : (eyes === 'happy' ? 'grin' : 'smile');
    }
    this.rig.face.draw(eyes, mouth);

    this.deformSkirt();
  }

  private solveLeg(side: 'L' | 'R', target: THREE.Vector3, p: number, L: number, contact: boolean, duty: number) {
    const B = this.rig.bones;
    const thigh = B[`thigh${side}`], shin = B[`shin${side}`], foot = B[`foot${side}`];
    // Target into hips space, relative to the hip joint.
    this.m.copy(B.hips.matrix).invert();
    const t = target.clone().applyMatrix4(this.m).sub(thigh.position);
    const L1 = LEG.thigh, L2 = LEG.shin;
    const d = THREE.MathUtils.clamp(t.length(), 0.25, L1 + L2 - 0.002);
    const yz = Math.hypot(t.y, t.z);
    const a = Math.atan2(-t.z, -t.y);
    const alpha = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const beta = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const roll = Math.atan2(t.x, yz);
    thigh.rotation.set(a - alpha, 0, roll);
    shin.rotation.set(Math.PI - beta, 0, 0);
    // Keep the sole flat while planted; a little toe-off at the end of stance and toe-up on swing.
    const hipsPitch = B.hips.rotation.x;
    let toe = 0;
    if (L > 0.01) {
      if (contact && p > duty * 0.75) toe = -0.5 * ((p - duty * 0.75) / (duty * 0.25)) * L;
      if (!contact) toe = 0.25 * Math.sin(((p - duty) / (1 - duty)) * Math.PI) * L;
    }
    foot.rotation.set(-(thigh.rotation.x + shin.rotation.x) - hipsPitch + toe, 0, -roll);
    this.lastFeet[side].copy(target);
  }

  /** Push skirt facets out of the way of the knees/thighs and add a little swing. */
  private deformSkirt() {
    const { geo, base, meta } = this.rig.skirt;
    const B = this.rig.bones;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const knees: THREE.Vector3[] = [];
    for (const s of ['L', 'R'] as const) {
      const k = new THREE.Vector3();
      B[`shin${s}`].getWorldPosition(k);
      B.hips.worldToLocal(k);
      knees.push(k);
    }
    const swing = Math.sin(this.phase * Math.PI * 2) * this.loco;
    for (let i = 0; i < arr.length / 3; i++) {
      const ang = meta[i * 2], t = meta[i * 2 + 1];
      let x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      if (t > 0) {
        const dx = Math.sin(ang), dz = Math.cos(ang);
        let push = 0;
        for (const k of knees) {
          // how far the knee pokes past the skirt surface in this facet's direction
          const kd = k.x * dx + k.z * dz;
          const r = Math.hypot(x, z);
          const w = Math.max(0, 1 - Math.abs(y - k.y) / 0.35);
          push = Math.max(push, (kd + 0.075 - r * 0.92) * w);
        }
        const h = t * t;
        push = Math.max(0, push) * Math.min(1, t * 1.6);
        x += dx * push + 0.02 * h * swing * dz * 0.3;
        z += dz * push - 0.035 * h * this.loco;
        y += 0.01 * h * Math.abs(swing);
      }
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    // blend facet normals toward the smooth radial normal: pleats stay readable, no low-poly faceting
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const na = nrm.array as Float32Array;
    for (let i = 0; i < na.length / 3; i++) {
      const ang = meta[i * 2];
      const rx = Math.sin(ang), rz = Math.cos(ang), ry = 0.32;
      const sg = na[i * 3] * rx + na[i * 3 + 2] * rz < 0 ? -0.35 : 0.35; // facet normals may face inward (winding)
      let x = na[i * 3] * sg + rx * 0.65, y = na[i * 3 + 1] * sg + ry * 0.65, z = na[i * 3 + 2] * sg + rz * 0.65;
      const l = Math.hypot(x, y, z) || 1;
      na[i * 3] = x / l; na[i * 3 + 1] = y / l; na[i * 3 + 2] = z / l;
    }
    nrm.needsUpdate = true;
  }
}
