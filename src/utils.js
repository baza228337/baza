import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const remap = (v, a, b) => clamp((v - a) / (b - a));
export const smoothstep = (a, b, v) => { const t = remap(v, a, b); return t * t * (3 - 2 * t); };
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t) => t * t * t;
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// 2D gradient noise + fbm (deterministic)
const perm = new Uint8Array(512);
{
  const r = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const grad2 = (h, x, y) => {
  switch (h & 7) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x; case 5: return -x; case 6: return y; default: return -y;
  }
};
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v) * 0.7;
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += noise2(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export function canvasTexture(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}

// Smooth camera-shake: sum of incommensurate sines
export function shake(t, seed = 0) {
  return new THREE.Vector3(
    Math.sin(t * 1.3 + seed) * 0.6 + Math.sin(t * 2.9 + seed * 2.1) * 0.3 + Math.sin(t * 7.1 + seed) * 0.1,
    Math.sin(t * 1.7 + seed * 1.7) * 0.6 + Math.sin(t * 3.3 + seed * 0.3) * 0.3 + Math.sin(t * 6.3 + seed * 3.1) * 0.1,
    Math.sin(t * 1.1 + seed * 0.7) * 0.5 + Math.sin(t * 2.3 + seed * 1.3) * 0.5,
  );
}

export const LOGDEPTH_VERT_PARS = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
export const LOGDEPTH_VERT = '#include <logdepthbuf_vertex>\n';
export const LOGDEPTH_FRAG_PARS = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';
export const LOGDEPTH_FRAG = '#include <logdepthbuf_fragment>\n';
