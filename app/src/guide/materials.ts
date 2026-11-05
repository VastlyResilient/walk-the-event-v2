import * as THREE from 'three';

/** Shared uniforms so every part of the guide reacts to the footage around her. */
export const guideUniforms = {
  uRim: { value: new THREE.Color(0.9, 0.3, 0.9) },
  uRimStrength: { value: 0.55 },
  uTint: { value: new THREE.Color(1, 1, 1) },
  uOutline: { value: 0.0065 },
  // Occlusion against the footage: scene disparity texture + per-frame metric fit.
  uDepthTex: { value: null as THREE.Texture | null },
  uDepthRect: { value: new THREE.Vector4(0, 0, 1, 1) }, // uv transform screen->depth panel
  uDepthFit: { value: new THREE.Vector2(0, 0) }, // 1/z = a*d + b  (a,b); a=0 disables occlusion
  uViewport: { value: new THREE.Vector2(1, 1) },
  uViewOffset: { value: new THREE.Vector2(0, 0) },
  uOpacity: { value: 1 },
  uOutlinePx: { value: 2.0 },
  // Local room light along her height (Meshy guide): feet / waist / head multipliers from the footage right around
  // her (App.lightFromRoom), so a pool of light on the floor lights her legs and fixtures above light her head.
  uBandLo: { value: new THREE.Color(1, 1, 1) },
  uBandMid: { value: new THREE.Color(1, 1, 1) },
  uBandHi: { value: new THREE.Color(1, 1, 1) },
  uShine: { value: 1 }, // hair highlight strength: follows the light overhead (no glossy hair in a dark corner)
  // (owner: "have her hair adapt with the shadows and lighting") the key light's direction (world, toward the light)
  // and how directional it is (0 diffuse .. 1 a fixture that stands out): the hair highlight moves toward it
  uKeyDir: { value: new THREE.Vector3(-0.3, 0.8, 0.5).normalize() },
  uKeyK: { value: 0 },
  uHairLit: { value: 1 }, // 0 with ?off=hairlight (the hair lit like the body only, as before)
};

let gradient: THREE.DataTexture | null = null;
function toonRamp(): THREE.DataTexture {
  if (gradient) return gradient;
  // Three crisp bands: shadow, mid, lit. Manga-style flat shading.
  const data = new Uint8Array([90, 90, 90, 255, 185, 185, 185, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const occlusionChunk = /* glsl */ `
  float guideOcc = 0.0;
  #ifdef GUIDE_OCCLUSION
  if (uDepthFit.x > 0.0) {
    vec2 suv = (gl_FragCoord.xy - uViewOffset) / uViewport;
    vec2 duv = uDepthRect.xy + suv * uDepthRect.zw;
    float d = texture2D(uDepthTex, vec2(duv.x, duv.y)).r;
    float maskv = texture2D(uDepthTex, vec2(duv.x, duv.y - 0.5)).r;
    float sceneZ = 1.0 / max(uDepthFit.x * d + uDepthFit.y, 0.02);
    // A person must be > 0.5 m nearer than her, anything else (pillars) > 0.9 m; feathered over 0.35 m.
    float gap = vGuideViewZ - sceneZ;
    float need = mix(0.9, 0.5, smoothstep(0.35, 0.65, maskv));
    guideOcc = smoothstep(need, need + 0.06, gap);
    if (guideOcc > 0.5) discard;
    guideOcc *= 2.0;
  }
  #endif
`;

function patch(mat: THREE.Material, opts: { rim?: boolean; occlude?: boolean; outline?: boolean; halftone?: boolean; tintScale?: number }) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, guideUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGuideViewZ;\nuniform float uOutline;\nuniform float uOutlinePx;\nuniform vec2 uViewport;')
      .replace(
        '#include <project_vertex>',
        opts.outline
          ? `vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
             vec3 nView = normalize(normalMatrix * normal);
             // Width grows gently with distance so the ink line stays readable but never chunky.
             mvPosition.xyz += nView * uOutline * 0.25;
             gl_Position = projectionMatrix * mvPosition;
             // constant-width ink in screen space so the line survives at companion size
             vec4 cn = projectionMatrix * vec4(nView, 0.0);
             vec2 dir = length(cn.xy) > 1e-5 ? normalize(cn.xy) : vec2(0.0);
             gl_Position.xy += dir * (uOutlinePx * 2.0 / uViewport) * gl_Position.w;
             vGuideViewZ = -mvPosition.z;`
          : `#include <project_vertex>\nvGuideViewZ = -mvPosition.z;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vGuideViewZ;
         uniform vec3 uRim; uniform float uRimStrength; uniform vec3 uTint; uniform float uOpacity;
         uniform sampler2D uDepthTex; uniform vec4 uDepthRect; uniform vec2 uDepthFit; uniform vec2 uViewport; uniform vec2 uViewOffset;`,
      )
      .replace('void main() {', `void main() {\n${opts.occlude !== false ? occlusionChunk : ''}`);
    if (opts.rim) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `outgoingLight *= mix(vec3(1.0), uTint, ${(opts.tintScale ?? 1).toFixed(2)});
         float ndl = dot(normalize(vNormal), normalize(vec3(-0.35, 0.75, 0.55)));
         vec2 hp = gl_FragCoord.xy / 7.0;
         float dotMask = step(length(fract(hp + vec2(0.5 * mod(floor(hp.y), 2.0), 0.0)) - 0.5), mix(0.0, 0.46, smoothstep(0.3, -0.4, ndl)));
         outgoingLight *= 1.0 - ${opts.halftone ? '0.32' : '0.0'} * dotMask;
         float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.6);
         outgoingLight += uRim * rim * uRimStrength * ${(opts.tintScale ?? 1).toFixed(2)};
         #include <opaque_fragment>`,
      );
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\ngl_FragColor.a *= uOpacity * (1.0 - guideOcc);',
    );
  };
  mat.defines = { ...(mat.defines || {}), GUIDE_OCCLUSION: '' };
  mat.transparent = true;
}

export function toon(color: THREE.ColorRepresentation, extra: Partial<THREE.MeshToonMaterialParameters> = {}, halftone = true, tintScale = 1) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...extra });
  patch(m, { rim: true, halftone, tintScale });
  m.customProgramCacheKey = () => `toon${halftone ? 'H' : ''}${tintScale}`;
  return m;
}

export function flat(color: THREE.ColorRepresentation, extra: Partial<THREE.MeshBasicMaterialParameters> = {}) {
  const m = new THREE.MeshBasicMaterial({ color, ...extra });
  patch(m, {});
  return m;
}

const outlineMats = new Map<number, THREE.MeshBasicMaterial>();
export function outlineMaterial(scale = 1) {
  const key = Math.round(scale * 100);
  let m = outlineMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: 0x07060a, side: THREE.BackSide });
    patch(m, { outline: true });
    if (scale !== 1) {
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (s, r) => {
        prev(s, r);
        s.vertexShader = s.vertexShader.replace('uOutline * clamp', `uOutline * ${scale.toFixed(2)} * clamp`);
      };
      m.customProgramCacheKey = () => `outline${key}`;
    }
    outlineMats.set(key, m);
  }
  return m;
}
