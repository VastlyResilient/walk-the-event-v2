import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GuideAnimator, type Gesture } from '../guide/anim';
import { buildGuide } from '../guide/model';

// Bake the procedural animation system into glTF clips (in place; root motion is applied by the app).
const rig = buildGuide();
const scene = new THREE.Scene();
scene.add(rig.root);
// Inverted-hull outlines and the contact shadow rely on custom shaders: leave them out of the portable GLB.
const drop: THREE.Object3D[] = [];
rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o.renderOrder === -1 || o === rig.contact)) drop.push(o); });
drop.forEach((o) => o.parent?.remove(o));
// Swap patched materials for plain toon/basic materials glTF understands.
rig.root.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  const src = m.material as THREE.MeshToonMaterial;
  const mat = new THREE.MeshStandardMaterial({ color: src.color, map: (src as any).map ?? null, roughness: 0.65, metalness: 0, vertexColors: !!src.vertexColors, transparent: !!(src as any).map, side: src.side });
  m.material = mat;
});
type Spec = { name: string; secs: number; speed?: number; yawRate?: number; slope?: number; gesture?: Gesture; hop?: boolean; talking?: boolean; point?: [number, number, number] };
const specs: Spec[] = [
  { name: 'idle', secs: 3.0 }, { name: 'idle_fidget_headband', secs: 2.6, gesture: 'fidgetHeadband' },
  { name: 'idle_look_around', secs: 3.5, gesture: 'lookAround' }, { name: 'idle_tap_foot', secs: 2.4, gesture: 'tapFoot' },
  { name: 'walk', secs: 0.8 / 1.2, speed: 1.2 }, { name: 'jog', secs: 1.24 / 2.4, speed: 2.4 }, { name: 'run', secs: 1.82 / 4.0, speed: 4.0 },
  { name: 'turn_in_place', secs: 1.6, yawRate: 2.2 }, { name: 'look_back', secs: 1.6, gesture: 'lookBack', speed: 1.0 },
  { name: 'beckon', secs: 1.8, gesture: 'beckon' }, { name: 'point_left', secs: 1.6, gesture: 'point', point: [2, 1.2, 1.5] },
  { name: 'point_right', secs: 1.6, gesture: 'point', point: [-2, 1.2, 1.5] }, { name: 'point_forward', secs: 1.6, gesture: 'point', point: [0.4, 1.3, 3] },
  { name: 'wave', secs: 1.8, gesture: 'wave' }, { name: 'excited_hop', secs: 0.9, hop: true }, { name: 'ta_da', secs: 1.8, gesture: 'tada', hop: true },
  { name: 'talk_1', secs: 2.4, gesture: 'talk', talking: true }, { name: 'talk_2', secs: 3.1, gesture: 'talk', talking: true },
  { name: 'lean_idle', secs: 3.0, gesture: 'handOnHip' }, { name: 'climb_stairs', secs: 0.8 / 1.0, speed: 1.0, slope: 0.6 },
];
const bones = Object.values(rig.bones);
const clips: THREE.AnimationClip[] = [];
for (const sp of specs) {
  const anim = new GuideAnimator(rig);
  const fps = 30;
  const warm = 1.2;
  const step = (hop: boolean) => anim.update({
    dt: 1 / fps, speed: sp.speed ?? 0, yawRate: sp.yawRate ?? 0, slope: sp.slope ?? 0, gesture: sp.gesture ?? 'none',
    pointAt: sp.point ? new THREE.Vector3(...sp.point) : undefined, lookAt: new THREE.Vector3(0, 1.4, 3), hop, talking: !!sp.talking, mood: 'neutral',
  });
  for (let i = 0; i < warm * fps; i++) step(false);
  if (sp.speed) anim.phase = 0;
  const times: number[] = [];
  const q: Record<string, number[]> = {};
  const hp: number[] = [];
  const n = Math.max(2, Math.round(sp.secs * fps) + 1);
  for (let i = 0; i < n; i++) {
    step(!!sp.hop && i === 0);
    times.push(i / fps);
    for (const b of bones) (q[b.name] ??= []).push(...b.quaternion.toArray());
    hp.push(...rig.bones.hips.position.toArray());
  }
  const tracks: THREE.KeyframeTrack[] = bones.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, q[b.name]));
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, hp));
  clips.push(new THREE.AnimationClip(sp.name, times[times.length - 1], tracks));
}
new GLTFExporter().parse(scene, (glb) => {
  const blob = new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
  (window as any).__glbSize = blob.size;
  blob.arrayBuffer().then((ab) => {
    const bytes = new Uint8Array(ab);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    (window as any).__glb = btoa(s);
    (window as any).__clips = clips.map((c) => c.name);
  });
}, (e) => { (window as any).__glbErr = String(e); }, { binary: true, animations: clips, onlyVisible: true });
