import { EYE_L, EYE_R, LIPS, LIPS_INNER, OVAL, TRI } from './self-portrait-mesh';

/*
 * WebGL2 renderer for "Self Portrait".
 *   1. scene pass (into an FBO): the sitter (camera or demo photo), placed by a 2D view transform, then the matched
 *      painting's face warped onto the sitter's face, landmark to landmark over MediaPipe's 852-triangle face mesh,
 *      colour-matched to the sitter's skin and feathered toward the outline, eyes and mouth (so the living face still
 *      reads through).
 *   2. finish pass (to the canvas): a painterly Kuwahara filter, old-master grade (warm, low-key light around the face,
 *      umber shadows), yellowed varnish, canvas weave and craquelure over the whole picture.
 *   3. while "studying": the tracked mesh drawn as fine gold lines and a scan band.
 * Coordinates: "source" = normalised sitter image (x right, y down); "out" = normalised picture (x right, y down).
 */

const NV = 468; // mesh vertices (the iris points 468-477 aren't part of the tessellation)

const VS_QUAD = `#version 300 es
in vec2 aPos; in vec2 aUv; out vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0); }`;
const FS_SRC = `#version 300 es
precision mediump float;
uniform sampler2D uTex; in vec2 vUv; out vec4 o;
void main(){ o = vec4(texture(uTex, vUv).rgb, 1.0); }`;

const VS_MESH = `#version 300 es
in vec3 aPos; in vec2 aUv; in float aA; out vec2 vUv; out float vA;
void main(){ vUv = aUv; vA = aA; gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, aPos.z, 1.0); }`;
const FS_MESH = `#version 300 es
precision mediump float;
uniform sampler2D uTex; uniform vec3 uPMean, uPSd, uVMean, uVSd; uniform float uMix;
in vec2 vUv; in float vA; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  // carry the painting's own modelling and brushwork, but in the sitter's own skin tone, so the seam disappears
  vec3 mean = mix(uPMean, uVMean, 0.85);
  vec3 gain = clamp(mix(uPSd, uVSd, 0.5) / max(uPSd, vec3(0.03)), 0.8, 1.2) * 1.1; // a touch of extra modelling survives the brushwork filter
  c = (c - uPMean) * gain + mean;
  o = vec4(clamp(c, 0.0, 1.0), vA * uMix);
}`;

const VS_POST = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const fsPost = (R: number) => `#version 300 es
precision highp float;
uniform sampler2D uScene; uniform vec2 uTexel; uniform vec2 uRes; uniform vec2 uLight; uniform float uLightR; uniform float uSeed;
uniform vec4 uBox; uniform float uScan;
in vec2 vUv; out vec4 o;
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p + uSeed) * 43758.5453); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float cracks(vec2 x){
  vec2 n = floor(x), f = fract(x), mg = vec2(0), mr = vec2(0); float md = 8.0;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){ vec2 g = vec2(i,j); vec2 r = g + hash2(n+g) - f; float d = dot(r,r); if (d < md){ md = d; mr = r; mg = g; } }
  md = 8.0;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){ vec2 g = mg + vec2(i,j); vec2 r = g + hash2(n+g) - f; if (dot(mr-r, mr-r) > 1e-5) md = min(md, dot(0.5*(mr+r), normalize(r-mr))); }
  return md;
}
void main(){
  // Kuwahara: the calmest of four overlapping quadrants -> flat, brushy patches with crisp edges
  const int R = ${R};
  vec3 m0=vec3(0), m1=vec3(0), m2=vec3(0), m3=vec3(0), s0=vec3(0), s1=vec3(0), s2=vec3(0), s3=vec3(0);
  for (int j=-R;j<=R;j++) for (int i=-R;i<=R;i++){
    vec3 c = texture(uScene, vUv + vec2(float(i), float(j)) * uTexel).rgb; vec3 c2 = c*c;
    if (i<=0 && j<=0){ m0+=c; s0+=c2; } if (i>=0 && j<=0){ m1+=c; s1+=c2; }
    if (i<=0 && j>=0){ m2+=c; s2+=c2; } if (i>=0 && j>=0){ m3+=c; s3+=c2; }
  }
  float n = float((R+1)*(R+1));
  m0/=n; m1/=n; m2/=n; m3/=n;
  vec3 v0=abs(s0/n-m0*m0), v1=abs(s1/n-m1*m1), v2=abs(s2/n-m2*m2), v3=abs(s3/n-m3*m3);
  float a0=v0.r+v0.g+v0.b, a1=v1.r+v1.g+v1.b, a2=v2.r+v2.g+v2.b, a3=v3.r+v3.g+v3.b;
  vec3 c = m0; float best = a0;
  if (a1 < best){ best = a1; c = m1; } if (a2 < best){ best = a2; c = m2; } if (a3 < best){ best = a3; c = m3; }
  // old-master grade: warm, a little desaturated, a pool of light on the face, the rest falling into umber
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.78);
  c = pow(max(c, 0.0), vec3(1.12));
  c *= vec3(1.08, 0.98, 0.82);
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  float d = length((vUv - uLight) * asp) / max(uLightR, 0.05);
  float light = 1.0 - smoothstep(0.5, 2.0, d);
  c *= mix(0.26, 1.1, light);
  vec3 umber = vec3(0.07, 0.045, 0.028);
  c = mix(umber, c, smoothstep(0.0, 0.36, l * mix(0.5, 1.1, light)));
  c = mix(c, c * vec3(1.0, 0.89, 0.64), 0.3); // yellowed varnish
  c = c / (c + 0.75) * 1.68;                  // soft shoulder
  // brush grain + canvas weave (in picture pixels, so the weave keeps its scale at any size)
  vec2 px = vUv * uRes;
  c *= 1.0 + (vnoise(px * vec2(0.55, 0.09) + vec2(c.r * 8.0, 0.0)) - 0.5) * 0.07;
  c *= 1.0 + sin(px.x * 1.7) * sin(px.y * 1.7) * 0.022;
  // craquelure, strongest toward the edges
  vec2 w = vUv * asp * 11.0 + (vec2(vnoise(vUv * 22.0), vnoise(vUv * 22.0 + 7.0)) - 0.5) * 0.7;
  float k = 1.0 - smoothstep(0.0, 0.035, cracks(w));
  float edge = smoothstep(0.15, 0.62, length(vUv - 0.5));
  c *= 1.0 - k * mix(0.04, 0.13, edge);
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 1.1;
  // studying: a gold band sweeping the face
  if (uScan > 0.0) {
    float inX = step(uBox.x, vUv.x) * step(vUv.x, uBox.z), inY = step(uBox.y, vUv.y) * step(vUv.y, uBox.w);
    float yb = mix(uBox.w, uBox.y, 0.5 - 0.5 * cos(uScan * 9.4248));
    float band = exp(-pow((vUv.y - yb) / 0.012, 2.0)) * inX * smoothstep(0.0, 0.1, uScan) * (1.0 - smoothstep(0.85, 1.0, uScan));
    c += vec3(1.0, 0.78, 0.4) * band * 0.55 + vec3(0.08, 0.05, 0.0) * inX * inY * (1.0 - uScan);
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
const FS_LINE = `#version 300 es
precision mediump float;
uniform float uA; out vec4 o;
void main(){ o = vec4(1.0, 0.84, 0.5, uA); }`;

/** Per-vertex opacity of the painted face: 0 on the outline, feathered inward; lowered over the eyes and the mouth. */
function vertexAlpha(ref: Float32Array) {
  const P = (i: number) => [ref[i * 2], ref[i * 2 + 1]];
  let y0 = 1, y1 = 0;
  for (const i of OVAL) { y0 = Math.min(y0, ref[i * 2 + 1]); y1 = Math.max(y1, ref[i * 2 + 1]); }
  const fh = y1 - y0 || 1;
  const segDist = (px: number, py: number, poly: number[]) => {
    let md = Infinity;
    for (let k = 0; k < poly.length; k++) {
      const [ax, ay] = P(poly[k]), [bx, by] = P(poly[(k + 1) % poly.length]);
      const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
      md = Math.min(md, Math.hypot(px - ax - vx * t, py - ay - vy * t));
    }
    return md / fh;
  };
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const centre = (idx: number[]) => { let x = 0, y = 0; for (const i of idx) { x += ref[i * 2]; y += ref[i * 2 + 1]; } return [x / idx.length, y / idx.length]; };
  const eyes = [EYE_L, EYE_R].map((e) => ({ c: centre(e), r: Math.max(...e.map((i) => Math.hypot(ref[i * 2] - centre(e)[0], ref[i * 2 + 1] - centre(e)[1]))) }));
  const mouth = centre(LIPS_INNER);
  const lipSet = new Set(LIPS), innerSet = new Set(LIPS_INNER), eyeSet = new Set([...EYE_L, ...EYE_R]);
  const a = new Float32Array(NV);
  for (let i = 0; i < NV; i++) {
    const [x, y] = P(i);
    let v = ss(0.0, 0.11, segDist(x, y, OVAL)) * 0.97;
    // eyes: the sitter's own eyes show through (the painting keeps the lids and brows)
    for (const e of eyes) { const d = Math.hypot(x - e.c[0], y - e.c[1]) / e.r; v *= 0.55 + 0.45 * ss(0.9, 1.6, d); }
    if (eyeSet.has(i)) v = Math.min(v, 0.58);
    // mouth: inner lips mostly the sitter's, outer lips half and half
    if (innerSet.has(i)) v = Math.min(v, 0.48);
    else if (lipSet.has(i)) v = Math.min(v, 0.72);
    const dm = Math.hypot(x - mouth[0], y - mouth[1]) / fh;
    v *= 0.65 + 0.35 * ss(0.02, 0.09, dm);
    a[i] = v;
  }
  return a;
}

export interface FaceIn { lm: Float32Array; z: Float32Array | null }
export interface DrawState {
  /** source -> out affine: x' = m0*x + m2*y + m4, y' = m1*x + m3*y + m5 (in source pixels normalised by the source size) */
  view: Float32Array;
  face: FaceIn | null;
  mix: [number, number];
  vMean: number[]; vSd: number[];
  light: [number, number]; lightR: number;
  scan: number; box: [number, number, number, number];
  lines: number;
}

export function createRenderer(canvas: HTMLCanvasElement, ref: Float32Array, quality: 'low' | 'high') {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'default' });
  if (!gl) throw new Error('no webgl2');
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const prog = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    const a = sh(gl.VERTEX_SHADER, vs), b = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    gl.deleteShader(a); gl.deleteShader(b);
    const U: Record<string, WebGLUniformLocation | null> = {};
    const u = (n: string) => (n in U ? U[n] : (U[n] = gl.getUniformLocation(p, n)));
    return { p, u, a: (n: string) => gl.getAttribLocation(p, n) };
  };
  const pSrc = prog(VS_QUAD, FS_SRC), pMesh = prog(VS_MESH, FS_MESH), pPost = prog(VS_POST, fsPost(quality === 'high' ? 3 : 2)), pLine = prog(VS_MESH, FS_LINE);

  const buf = (data: ArrayBufferView | null, target: number = gl.ARRAY_BUFFER, usage: number = gl.STATIC_DRAW, size = 0) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(target, b);
    if (data) gl.bufferData(target, data, usage); else gl.bufferData(target, size, usage);
    return b;
  };
  const attr = (vao: WebGLVertexArrayObject, b: WebGLBuffer, loc: number, n: number) => {
    if (loc < 0) return;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
  };

  // source quad (4 corners of the sitter image, placed by the view transform)
  const quadPos = buf(null, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW, 32), quadUv = buf(null, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW, 32);
  const vaoSrc = gl.createVertexArray()!;
  attr(vaoSrc, quadPos, pSrc.a('aPos'), 2); attr(vaoSrc, quadUv, pSrc.a('aUv'), 2);
  // face mesh
  const meshPos = buf(null, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW, NV * 12);
  const alpha = buf(vertexAlpha(ref));
  const idx = buf(TRI, gl.ELEMENT_ARRAY_BUFFER);
  const slots = [0, 1].map(() => {
    const uv = buf(null, gl.ARRAY_BUFFER, gl.STATIC_DRAW, NV * 8);
    const vao = gl.createVertexArray()!;
    attr(vao, meshPos, pMesh.a('aPos'), 3); attr(vao, uv, pMesh.a('aUv'), 2); attr(vao, alpha, pMesh.a('aA'), 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    const tex = gl.createTexture()!;
    return { uv, vao, tex, mean: [0.5, 0.4, 0.3], sd: [0.1, 0.1, 0.1], ready: false };
  });
  // wireframe (unique triangle edges)
  const edges: number[] = [];
  { const seen = new Set<number>(); for (let t = 0; t < TRI.length; t += 3) for (const [a, b] of [[TRI[t], TRI[t + 1]], [TRI[t + 1], TRI[t + 2]], [TRI[t + 2], TRI[t]]]) { const k = Math.min(a, b) * 1000 + Math.max(a, b); if (!seen.has(k)) { seen.add(k); edges.push(a, b); } } }
  const vaoLine = gl.createVertexArray()!;
  attr(vaoLine, meshPos, pLine.a('aPos'), 3);
  const edgeBuf = buf(new Uint16Array(edges), gl.ELEMENT_ARRAY_BUFFER);
  gl.bindVertexArray(null);
  // post
  const postBuf = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));
  const vaoPost = gl.createVertexArray()!;
  attr(vaoPost, postBuf, pPost.a('p'), 2);
  gl.bindVertexArray(null);

  const texInit = (t: WebGLTexture, mip = false) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const srcTex = gl.createTexture()!;
  texInit(srcTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  // scene FBO (colour + depth)
  const sceneTex = gl.createTexture()!;
  texInit(sceneTex);
  const depth = gl.createRenderbuffer()!;
  const fbo = gl.createFramebuffer()!;
  let W = 2, H = 2;
  const resize = (w: number, h: number) => {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (w === W && h === H) return;
    W = w; H = h;
    canvas.width = w; canvas.height = h;
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  resize(4, 5);

  let srcObj: TexImageSource | null = null, srcW = 1, srcH = 1, flipU = false;
  const seed = Math.random() * 10;
  const pos = new Float32Array(NV * 3);
  const qp = new Float32Array(8), qu = new Float32Array(8);
  let last: DrawState | null = null;
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });

  return {
    canvas,
    get lost() { return lost; },
    resize,
    /** Upload the sitter. `live` sources (video) are re-uploaded every draw; still images once. */
    setSource(src: TexImageSource, w: number, h: number, mirror: boolean) {
      srcW = w; srcH = h; flipU = mirror;
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      srcObj = src;
    },
    updateSource() {
      if (!srcObj) return;
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcObj);
    },
    get srcSize() { return [srcW, srcH] as const; },
    /** Put a painting (image + its landmarks + skin stats) into slot 0 or 1. */
    setPortrait(slot: 0 | 1, im: HTMLImageElement, lm: Float32Array, mean: number[], sd: number[]) {
      const s = slots[slot];
      texInit(s.tex, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.uv);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lm.subarray(0, NV * 2));
      s.mean = mean; s.sd = sd; s.ready = true;
    },
    swapSlots() { const t = slots[0]; slots[0] = slots[1]; slots[1] = t; },
    draw(st: DrawState) {
      if (lost || !srcObj) return;
      last = st;
      const m = st.view;
      // ---- scene pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.07, 0.045, 0.03, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
      corners.forEach(([x, y], i) => {
        qp[i * 2] = m[0] * x + m[2] * y + m[4]; qp[i * 2 + 1] = m[1] * x + m[3] * y + m[5];
        qu[i * 2] = flipU ? 1 - x : x; qu[i * 2 + 1] = y;
      });
      gl.useProgram(pSrc.p);
      gl.bindVertexArray(vaoSrc);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, qp);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadUv); gl.bufferSubData(gl.ARRAY_BUFFER, 0, qu);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(pSrc.u('uTex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (st.face) {
        const L = st.face.lm, Z = st.face.z;
        for (let i = 0; i < NV; i++) {
          const x = L[i * 2], y = L[i * 2 + 1];
          pos[i * 3] = m[0] * x + m[2] * y + m[4];
          pos[i * 3 + 1] = m[1] * x + m[3] * y + m[5];
          pos[i * 3 + 2] = Z ? Math.max(-0.95, Math.min(0.95, Z[i] * 2)) : 0;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, meshPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
        if (st.mix[0] > 0.001 || st.mix[1] > 0.001) {
          gl.useProgram(pMesh.p);
          gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.uniform3fv(pMesh.u('uVMean'), st.vMean); gl.uniform3fv(pMesh.u('uVSd'), st.vSd);
          gl.uniform1i(pMesh.u('uTex'), 0);
          for (const k of [0, 1] as const) {
            const s = slots[k];
            if (!s.ready || st.mix[k] <= 0.001) continue;
            gl.bindVertexArray(s.vao);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
            gl.bindTexture(gl.TEXTURE_2D, s.tex);
            gl.uniform3fv(pMesh.u('uPMean'), s.mean); gl.uniform3fv(pMesh.u('uPSd'), s.sd);
            gl.uniform1f(pMesh.u('uMix'), st.mix[k]);
            gl.drawElements(gl.TRIANGLES, TRI.length, gl.UNSIGNED_SHORT, 0);
          }
          gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        }
      }
      // ---- finish pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(pPost.p);
      gl.bindVertexArray(vaoPost);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.uniform1i(pPost.u('uScene'), 0);
      gl.uniform2f(pPost.u('uTexel'), 1 / W, 1 / H);
      gl.uniform2f(pPost.u('uRes'), W, H);
      gl.uniform2f(pPost.u('uLight'), st.light[0], 1 - st.light[1]);
      gl.uniform1f(pPost.u('uLightR'), st.lightR);
      gl.uniform1f(pPost.u('uSeed'), seed);
      gl.uniform4f(pPost.u('uBox'), st.box[0], 1 - st.box[3], st.box[2], 1 - st.box[1]);
      gl.uniform1f(pPost.u('uScan'), st.scan);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // ---- studying: the tracked mesh as fine gold lines
      if (st.face && st.lines > 0.01) {
        gl.useProgram(pLine.p);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.bindVertexArray(vaoLine);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeBuf);
        gl.uniform1f(pLine.u('uA'), st.lines * 0.4);
        gl.drawElements(gl.LINES, edges.length, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    },
    /** Draw the last state again (so a snapshot can read the canvas inside the same task). */
    redraw() { if (last) this.draw(last); },
    dispose() {
      for (const s of slots) { gl.deleteTexture(s.tex); gl.deleteBuffer(s.uv); gl.deleteVertexArray(s.vao); }
      for (const b of [quadPos, quadUv, meshPos, alpha, idx, edgeBuf, postBuf]) gl.deleteBuffer(b);
      for (const v of [vaoSrc, vaoLine, vaoPost]) gl.deleteVertexArray(v);
      for (const p of [pSrc, pMesh, pPost, pLine]) gl.deleteProgram(p.p);
      gl.deleteTexture(srcTex); gl.deleteTexture(sceneTex); gl.deleteRenderbuffer(depth); gl.deleteFramebuffer(fbo);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
export type Renderer = ReturnType<typeof createRenderer>;
