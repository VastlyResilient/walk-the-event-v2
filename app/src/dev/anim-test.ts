import * as THREE from 'three';
import { loadMeshyRig } from '../guide/meshy';
// drive the real animator: ?gesture=point&px=&py=&pz=&speed=&yawRate=&stairs=1&T=2&yaw=0.4&dist=4.2&rail=x,y,z
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? parseFloat(q.get(k)!) : d);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3f4a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.0));
const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(1, 2, 3); scene.add(d);
scene.add(new THREE.GridHelper(6, 12, 0x888888, 0x555555));
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 50);
const { rig, anim } = await loadMeshyRig(q.get('model') ?? '/media/guide/hermes-v5.glb');
scene.add(rig.root);
const yaw = num('yaw', 0.4), dist = num('dist', 4.2);
cam.position.set(Math.sin(yaw) * dist, num('cy', 1.15), Math.cos(yaw) * dist);
cam.lookAt(0, num('ly', 0.85), 0);
const target = new THREE.Vector3(num('px', -3), num('py', 1.2), num('pz', 1));
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.08), new THREE.MeshBasicMaterial({ color: 0xff3399 }));
marker.position.copy(target); scene.add(marker);
const rail = q.get('rail')?.split(',').map(Number);
const T = num('T', 2), dt = 1 / 60;
const camLocal = cam.position.clone();
const move = q.has('move');
const fv: number[] = [], fy: number[] = [];
const B = (rig as any).bones, prevF = { L: new THREE.Vector3(), R: new THREE.Vector3() }, cur = new THREE.Vector3();
const prevT = { L: new THREE.Vector3(), R: new THREE.Vector3() }, tv: number[] = [], prevTL = new THREE.Vector3();
for (let t = 0; t < T; t += dt) {
  if (move) {
    // ?curve=1: walk an arc (root yaws at yawRate); ?jitter=0.2: per-frame speed noise (brain-like unevenness)
    if (q.has('curve')) rig.root.rotation.y += num('yawRate', 0) * dt;
    const v = num('speed', 0) * (1 + num('jitter', 0) * (Math.random() * 2 - 1)) * (q.has('back') ? -1 : 1); // ?back=1: stepping backwards
    rig.root.position.x += Math.sin(rig.root.rotation.y) * v * dt; rig.root.position.z += Math.cos(rig.root.rotation.y) * v * dt;
    rig.root.updateMatrixWorld(true);
  }
  anim.update({
    dt, speed: num('speed', 0), yawRate: q.has('curve') ? 0 : num('yawRate', 0), slope: num('slope', 0), gesture: (q.get('gesture') || 'none') as any,
    pointAt: target, lookAt: camLocal, hop: false, talking: false, mood: 'happy', energy: num('energy', 0),
    stairs: q.get('stairs') === '1', jog: q.has('jog'), groove: num('groove', 0), beat: (t * num('bpm', 128)) / 60, railAt: rail ? new THREE.Vector3(rail[0], rail[1], rail[2]) : undefined, railSide: (q.get('railSide') as any) || 'Right',
  });
  if (move) {
    rig.root.updateMatrixWorld(true);
    const l = B.LeftFoot.getWorldPosition(new THREE.Vector3()), r = B.RightFoot.getWorldPosition(new THREE.Vector3());
    const tl = B.LeftToeBase.getWorldPosition(new THREE.Vector3()), tr = B.RightToeBase.getWorldPosition(new THREE.Vector3());
    if (t > 1) {
      const pl = l.y < r.y ? 'L' : 'R'; cur.copy(pl === 'L' ? l : r); const pv = (prevF as any)[pl]; fv.push(Math.hypot(cur.x - pv.x, cur.z - pv.z) / dt); fy.push(Math.min(l.y, r.y));
      // the audit's measure: ball-of-foot (toe bone) speed of the lower foot
      const tc = pl === 'L' ? tl : tr, tp = (prevT as any)[pl]; tv.push(Math.hypot(tc.x - tp.x, tc.z - tp.z) / dt);
    }
    prevF.L.copy(l); prevF.R.copy(r); prevT.L.copy(tl); prevT.R.copy(tr);
    if (q.has('log') && t > 1) { const pl = (anim as any).plant, ry = rig.root.position.y, bf = (anim as any).bindFloor, bt = (anim as any).bindToe;
      ((window as any).__log ??= []).push([+(l.y - ry - bf).toFixed(3), +(tl.y - ry - bt).toFixed(3), pl.Left.on ? (pl.Left.toe ? 2 : 1) : 0, +pl.Left.k.toFixed(2), +((Math.hypot(tl.x - prevTL.x, tl.z - prevTL.z)) / dt).toFixed(2), +Math.min(l.y - ry - bf, r.y - ry - bf, tl.y - ry - bt, tr.y - ry - bt).toFixed(3)]); }
    prevTL.copy(tl);
  }
}
if (move) { cam.position.z += rig.root.position.z; cam.lookAt(0, 0.85, rig.root.position.z); const minY = Math.min(...fy); const so = fv.filter((_, i) => fy[i] < minY + 0.03).sort((a, b) => a - b); const st = tv.filter((_, i) => fy[i] < minY + 0.03).sort((a, b) => a - b); (window as any).__foot = { p50: so[Math.floor(so.length * 0.5)], p95: so[Math.floor(so.length * 0.95)], toe50: st[Math.floor(st.length * 0.5)], toe95: st[Math.floor(st.length * 0.95)] }; }
renderer.render(scene, cam);
(window as any).__ready = true; (window as any).__stride = (anim as any).stride; (window as any).__an = anim; (window as any).__g = (anim as any).groundOff;
