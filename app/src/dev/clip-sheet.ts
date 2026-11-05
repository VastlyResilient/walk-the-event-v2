import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
// raw clip viewer: ?url=&clip=&t=&yaw=  (no app processing) -> window.__ready
const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3f4a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.0));
const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(1, 2, 3); scene.add(d);
const grid = new THREE.GridHelper(4, 8, 0x888888, 0x555555); scene.add(grid);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 50);
const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(q.get('url') || '/media/guide/hermes-v5.glb');
const model = g.scene;
model.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(model);
const k = 1.6 / (box.max.y - box.min.y);
model.scale.setScalar(k); model.position.y = -box.min.y * k;
model.traverse((o: any) => { if (o.isMesh) o.frustumCulled = false; });
scene.add(model);
const yaw = parseFloat(q.get('yaw') || '0.4');
cam.position.set(Math.sin(yaw) * 4.2, 1.1, Math.cos(yaw) * 4.2);
cam.lookAt(0, 0.82, 0);
const mixer = new THREE.AnimationMixer(model);
const clip = g.animations.find((c) => c.name === (q.get('clip') || 'idle'));
if (clip) { const a = mixer.clipAction(clip); a.play(); mixer.update(parseFloat(q.get('t') || '0')); }
// ?follow=1: travelling clips (walks) keep her centred: the camera follows the hips across the floor
if (q.has('follow')) {
  let hips: THREE.Object3D | undefined; model.traverse((o) => { if (/hips/i.test(o.name) && !hips) hips = o; });
  if (hips) { model.updateMatrixWorld(true); const hp = hips.getWorldPosition(new THREE.Vector3()); cam.position.x += hp.x; cam.position.z += hp.z; cam.lookAt(hp.x, 0.82, hp.z); grid.position.set(Math.round(hp.x * 2) / 2, 0, Math.round(hp.z * 2) / 2); }
}
renderer.render(scene, cam);
(window as any).__ready = { clips: g.animations.map((c) => [c.name, +c.duration.toFixed(2)]) };
