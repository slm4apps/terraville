// SPDX-License-Identifier: Apache-2.0
// noise.js -- seeded 2D gradient noise + fBm. Deterministic: the same (seed, x, z) always gives the same value, in the browser and in node.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** integer hash of (seed, a, b) -> [0,1) -- used for chunk-local placement so a chunk is rebuilt identically every time */
export function hash2(seed, a, b) {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h ^ (a * 31 + b * 17) | 0, 0x27d4eb2f); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512), gx = new Float32Array(256), gz = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, z) {                       // gradient noise, about [-1, 1]
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const X = xi & 255, Z = zi & 255;
    const g = (ix, iz, dx, dz) => { const h = perm[perm[X + ix] + Z + iz]; return gx[h] * dx + gz[h] * dz; };
    const u = fade(xf), v = fade(zf);
    const a = g(0, 0, xf, zf), b = g(1, 0, xf - 1, zf), c = g(0, 1, xf, zf - 1), d = g(1, 1, xf - 1, zf - 1);
    return (a + u * (b - a) + v * (c + u * (d - c) - (a + u * (b - a)))) * 1.4;
  }
  function fbm(x, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < octaves; i++) { s += noise(x * f, z * f) * amp; norm += amp; amp *= gain; f *= lacunarity; }
    return s / norm;
  }
  return { noise, fbm };
}
