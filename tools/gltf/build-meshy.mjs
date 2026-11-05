// Build the web GLB for the Meshy Hermes guide: rigged mesh + named clips from the animation files.
//   node build-meshy.mjs <rigged.glb> <out.glb> <animA.glb>:<names,...> [<animB.glb>:<names,...>] [<walking.glb>:walk_basic]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, simplify, weld, textureCompress, meshopt, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const [, , riggedPath, outPath, ...animSpecs] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const doc = await io.read(riggedPath);
const root = doc.getRoot();
const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
for (const a of root.listAnimations()) a.dispose(); // the rigged file's placeholder clip

for (const spec of animSpecs) {
  const [file, namesStr] = spec.split(':');
  const names = namesStr.split(',');
  const src = await io.read(file);
  src.getRoot().listAnimations().forEach((anim, i) => {
    const name = names[i] ?? anim.getName();
    if (name === '-') return; // '-' in the name list skips that clip
    const out = doc.createAnimation(name);
    for (const ch of anim.listChannels()) {
      const target = ch.getTargetNode();
      const dst = target && nodesByName.get(target.getName());
      if (!dst) continue;
      const s = ch.getSampler();
      const inp = doc.createAccessor().setArray(s.getInput().getArray().slice()).setType('SCALAR');
      let arr = s.getOutput().getArray().slice();
      // dances / waves that travel: pin the hips horizontally (keep the vertical bounce) so she dances on her spot
      const pinned = (process.env.PIN || 'idle,turn,turn_l,turn_r,look_around,sway,wave_big,wave_hand,wave_help,talk_right,talk_open,talk_hip,hop,cheer,call,heart,agree,dance_joy,dance_night,dance_groove').split(',').includes(name);
      // turn-in-place clips rotate her whole body ~90 degrees: strip the hips' twist about the vertical so the clip is
      // just the stepping, and the brain supplies the yaw (she steps through a turn instead of pivot-sliding)
      if (/^turn/.test(name) && ch.getTargetPath() === 'rotation' && target.getName() === 'Hips') {
        const n = arr.length / 4;
        const tw = (k) => { const y = arr[k * 4 + 1], w = arr[k * 4 + 3], l = Math.hypot(y, w) || 1; return [y / l, w / l]; };
        const [y0, w0] = tw(0);
        const out = new Float32Array(arr.length);
        for (let k = 0; k < n; k++) {
          const [yk, wk] = tw(k);
          // rel = twist_k * inverse(twist_0) (both about Y): angle difference
          const ry = yk * w0 - wk * y0, rw = wk * w0 + yk * y0;
          // q' = inverse(rel) * q_k ; inverse(rel) = (0,-ry,0,rw)
          const qx = arr[k * 4], qy = arr[k * 4 + 1], qz = arr[k * 4 + 2], qw = arr[k * 4 + 3];
          const ax = 0, ay = -ry, az = 0, aw = rw;
          out[k * 4] = aw * qx + ax * qw + ay * qz - az * qy;
          out[k * 4 + 1] = aw * qy - ax * qz + ay * qw + az * qx;
          out[k * 4 + 2] = aw * qz + ax * qy - ay * qx + az * qw;
          out[k * 4 + 3] = aw * qw - ax * qx - ay * qy - az * qz;
        }
        arr = out;
      }
      if (pinned && ch.getTargetPath() === 'translation' && target.getName() === 'Hips') {
        // pin to the rig's rest position (not the clip's first frame: some clips start off to one side)
        const rest = dst.getTranslation();
        const n = arr.length / 3, x0 = rest[0], z0 = rest[2];
        for (let k = 0; k < n; k++) { arr[k * 3] = x0; arr[k * 3 + 2] = z0; }
      } else
      // keep clips in place: remove the hips' horizontal drift (the guide brain moves her root)
      if (ch.getTargetPath() === 'translation' && target.getName() === 'Hips') {
        const n = arr.length / 3;
        const x0 = arr[0], z0 = arr[2], x1 = arr[(n - 1) * 3], z1 = arr[(n - 1) * 3 + 2];
        const rest = dst.getTranslation();
        // remove the drift, and centre the cycle on the rest position (mean offset) so she walks over her own root
        for (let k = 0; k < n; k++) { const t = n > 1 ? k / (n - 1) : 0; arr[k * 3] -= (x1 - x0) * t; arr[k * 3 + 2] -= (z1 - z0) * t; }
        let mx = 0, mz = 0;
        for (let k = 0; k < n; k++) { mx += arr[k * 3]; mz += arr[k * 3 + 2]; }
        mx /= n; mz /= n;
        for (let k = 0; k < n; k++) { arr[k * 3] += rest[0] - mx; arr[k * 3 + 2] += rest[2] - mz; }
        // climbing clips rise one step per loop: remove the linear vertical drift too (the brain owns her height),
        // or she floats up through each cycle and snaps back down ("levitating" on the stairs)
        const y0 = arr[1], y1 = arr[(n - 1) * 3 + 1];
        if (Math.abs(y1 - y0) > 1e-3) for (let k = 0; k < n; k++) { const t = n > 1 ? k / (n - 1) : 0; arr[k * 3 + 1] -= (y1 - y0) * t; }
      }
      const outAcc = doc.createAccessor().setArray(arr).setType(s.getOutput().getType());
      const samp = doc.createAnimationSampler().setInput(inp).setOutput(outAcc).setInterpolation(s.getInterpolation());
      out.addSampler(samp).addChannel(doc.createAnimationChannel().setTargetNode(dst).setTargetPath(ch.getTargetPath()).setSampler(samp));
    }
    console.log('clip', name, anim.listChannels().length, 'channels');
  });
}
// mirrored copies (MIRROR="talk_right:talk_left"): swap Left/Right tracks and reflect across her sagittal plane.
// Meshy's rig has mirror-symmetric local frames (Left q = (x,y,z,w) <-> Right q = (x,-y,-z,w)), so a rotation key
// reflects to (x,-y,-z,w) on the opposite bone; the hips' translation reflects x -> -x. Other translation tracks
// are dropped (bones keep their rest offsets).
for (const pair of (process.env.MIRROR || '').split(',').filter(Boolean)) {
  const [from, to] = pair.split(':');
  const srcAnim = root.listAnimations().find((a) => a.getName() === from);
  if (!srcAnim) { console.warn('mirror: no clip', from); continue; }
  const out = doc.createAnimation(to);
  for (const ch of srcAnim.listChannels()) {
    const tn = ch.getTargetNode().getName();
    const mirrorName = tn.startsWith('Left') ? 'Right' + tn.slice(4) : tn.startsWith('Right') ? 'Left' + tn.slice(5) : tn;
    const dst = nodesByName.get(mirrorName);
    if (!dst) continue;
    const path = ch.getTargetPath(), s = ch.getSampler();
    let arr = s.getOutput().getArray().slice();
    if (path === 'rotation') { for (let k = 0; k < arr.length; k += 4) { arr[k + 1] = -arr[k + 1]; arr[k + 2] = -arr[k + 2]; } }
    else if (path === 'translation') { if (tn !== 'Hips') continue; const rx = dst.getTranslation()[0]; for (let k = 0; k < arr.length; k += 3) arr[k] = 2 * rx - arr[k]; }
    const inp = doc.createAccessor().setArray(s.getInput().getArray().slice()).setType('SCALAR');
    const outAcc = doc.createAccessor().setArray(arr).setType(s.getOutput().getType());
    const samp = doc.createAnimationSampler().setInput(inp).setOutput(outAcc).setInterpolation(s.getInterpolation());
    out.addSampler(samp).addChannel(doc.createAnimationChannel().setTargetNode(dst).setTargetPath(path).setSampler(samp));
  }
  console.log('mirrored', from, '->', to);
}
// higher-quality texture set (BASE=<png> NORMAL=<png>): Meshy retexture painted on the same UVs, so it drops in
for (const mat of root.listMaterials()) {
  const img = (f) => doc.createTexture(f.split('/').pop()).setImage(new Uint8Array(fs.readFileSync(f))).setMimeType('image/png');
  if (process.env.BASE) mat.setBaseColorTexture(img(process.env.BASE));
  if (process.env.NORMAL) mat.setNormalTexture(img(process.env.NORMAL)).setNormalScale(1);
}
const ratio = parseFloat(process.env.RATIO || '0.22');
await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004, lockBorder: false }),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /baseColor/, resize: [parseInt(process.env.TEX || '1024'), parseInt(process.env.TEX || '1024')], quality: 88 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /normal/, resize: [parseInt(process.env.NTEX || '2048'), parseInt(process.env.NTEX || '2048')], quality: 90 }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(outPath, doc);
const tris = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log('wrote', outPath, 'tris', tris, 'clips', root.listAnimations().map((a) => a.getName()).join(','));
