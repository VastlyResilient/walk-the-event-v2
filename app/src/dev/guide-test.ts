import * as THREE from 'three';
import { buildGuide } from '../guide/model';
import { GuideAnimator, type Gesture } from '../guide/anim';
import { guideUniforms } from '../guide/materials';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const bg = new THREE.Color(0x3a1050);
scene.background = bg;
scene.add(new THREE.HemisphereLight(0xffffff, 0x553366, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1.5, 3, 2.5);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x5a2a6a }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 50);
const rig = buildGuide();
scene.add(rig.root);
const anim = new GuideAnimator(rig);
const params = new URLSearchParams(location.search);
let gesture = (params.get('g') || 'none') as Gesture;
let speed = parseFloat(params.get('speed') || '0');
let yawRate = 0;
let camYaw = parseFloat(params.get('yaw') || '0.5');
let hop = false;
const hud = document.getElementById('hud')!;
const gestures: Gesture[] = ['none', 'wave', 'point', 'beckon', 'tada', 'talk', 'lookBack', 'fidgetHeadband', 'lookAround', 'handOnHip', 'tapFoot'];
for (const g of gestures) { const b = document.createElement('button'); b.textContent = g; b.onclick = () => (gesture = g); hud.appendChild(b); }
for (const s of [0, 0.6, 1.2, 2.4, 4]) { const b = document.createElement('button'); b.textContent = `v${s}`; b.onclick = () => (speed = s); hud.appendChild(b); }
const hb = document.createElement('button'); hb.textContent = 'hop'; hb.onclick = () => (hop = true); hud.appendChild(hb);
addEventListener('pointermove', (e) => { if (e.buttons) camYaw += e.movementX * 0.01; });
guideUniforms.uRim.value.set(0xff40c0);
let last = performance.now();
let freeze = params.get('t') ? parseFloat(params.get('t')!) : -1;
function frame(now: number) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (freeze >= 0) { dt = 1 / 30; }
  const steps = freeze >= 0 && anim.t < freeze ? Math.ceil((freeze - anim.t) * 30) : 1;
  for (let i = 0; i < steps; i++) {
    anim.update({ dt, speed, yawRate, slope: 0, gesture, pointAt: new THREE.Vector3(1.5, 1.2, 1.5), lookAt: camera.position.clone(), hop, talking: gesture === 'talk', mood: 'neutral' });
    hop = false;
  }
  const r = 3.6;
  camera.position.set(Math.sin(camYaw) * r, 1.15, Math.cos(camYaw) * r);
  camera.lookAt(0, 0.86, 0);
  guideUniforms.uViewport.value.set(renderer.domElement.width, renderer.domElement.height);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as any).__ready = true;
