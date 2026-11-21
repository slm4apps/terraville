// SPDX-License-Identifier: Apache-2.0
// world.js -- the CODE side of the world: an endless terrain made of chunks around the player, built from a resolved spec (resolveWorld in spec.js).
// Only the chunks inside the view ring exist; walking builds the ones ahead (one per frame) and frees the ones behind. A chunk is a pure function of
// (spec, seed, cx, cz): rebuilt anywhere, any time, it comes out identical. All numbers come from the tables in spec.js, none from the model.
import * as THREE from 'three';
import { makeNoise, mulberry32, hash2 } from './noise.js';
import { TABLES } from './spec.js';
import { saturate } from './styles.js';

export const CHUNK = 64;            // metres
export const GRID = 65;             // vertices per side (64 cells)
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function makeTerrain(rw) {
  const { fbm } = makeNoise(rw.seed);
  const { noise: relNoise } = makeNoise(rw.seed + 101);
  const amp = rw.amplitude, f = rw.frequency;
  const hasWater = rw.water !== 'none' || rw.biome === 'island' || rw.biome === 'beach';
  const waterLevel = hasWater ? 0 : -1e9;
  const sea = rw.water === 'sea' || rw.biome === 'island' || rw.biome === 'beach';
  function height(x, z) {
    let h = fbm(x * f, z * f, 5) * amp;
    if (rw.biome === 'mountains') h += Math.abs(fbm(x * f * 0.6 + 40, z * f * 0.6, 4)) * amp * 0.9;   // ridges on top
    if (rw.biome === 'desert') h += Math.sin(x * 0.045 + fbm(x * 0.01, z * 0.01, 2) * 6) * 1.2;       // dunes
    if (sea && rw.biome !== 'island') h -= amp * 0.45;                                                  // lowlands flood
    // a sea world with flat terrain (e.g. "gta style" on a flat zombies map: beach + sea, relief ~1 m) flooded everything: no dry land
    // within 200 m, the player stood at sea. Low-relief sea worlds get a broad low swell of land with beaches.
    if (sea && rw.biome !== 'island' && amp < 4) h += 1.0 + fbm(x * 0.002 + 13, z * 0.002 - 7, 3) * 7;
    if (rw.biome === 'island') {
      const m = smooth(-0.15, 0.35, fbm(x * 0.0016 + 7, z * 0.0016 - 3, 3));                           // land mask
      h = h * m + (m - 1) * 22 + m * 3;
    }
    if (rw.water === 'lake') h -= smooth(0.26, 0.42, fbm(x * 0.004 + 11, z * 0.004 + 5, 2)) * (amp * 0.9 + 6);
    if (rw.water === 'river') { const n = fbm(x * 0.0035 + 2, z * 0.0035 + 9, 3); h -= Math.exp(-((n / 0.035) ** 2)) * 7; }
    if (rw.biome === 'swamp') h = h * 0.4 - 0.6 + relNoise(x * 0.05, z * 0.05) * 0.25;
    if (rw.voxel) h = Math.round(h / rw.voxel) * rw.voxel;                    // blocky ground (minecraft-like styles)
    if (hasWater && Math.abs(h - waterLevel) < 0.08) h = waterLevel + (h < waterLevel ? -0.08 : 0.08);   // never exactly at the water line: no flicker
    return h;
  }
  return { height, waterLevel };
}

// ---- small template meshes, merged into one geometry per chunk (one draw call for all plants + structures of a chunk) ----
function tpl(geom, color) { const g = geom.index ? geom.toNonIndexed() : geom; return { pos: g.attributes.position.array, nor: g.attributes.normal.array, color: new THREE.Color(color) }; }
const T = {
  crown: tpl(new THREE.ConeGeometry(1.4, 3.4, 7).translate(0, 3.7, 0), 0xffffff),
  trunk: tpl(new THREE.CylinderGeometry(0.2, 0.28, 2.2, 6).translate(0, 1.1, 0), 0x6b4423),
  rock: tpl(new THREE.IcosahedronGeometry(0.8, 0).translate(0, 0.35, 0), 0x8a8a85),
  blade: tpl(new THREE.ConeGeometry(0.14, 0.9, 3).translate(0, 0.45, 0), 0x7bbf4a),
  flower: tpl(new THREE.IcosahedronGeometry(0.2, 0).translate(0, 0.5, 0), 0xffffff),
  crystal: tpl(new THREE.OctahedronGeometry(0.45, 0).scale(1, 2.2, 1).translate(0, 0.9, 0), 0x5fe0ff),
  box: tpl(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), 0xffffff),
  cone: tpl(new THREE.ConeGeometry(0.5, 1, 6).translate(0, 0.5, 0), 0xffffff),
  cyl: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0), 0xffffff),
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _n = new THREE.Matrix3();
class Merge {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  add(t, x, y, z, sx, sy, sz, ry, color) {
    _e.set(0, ry, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz); _m.compose(_p, _q, _s); _n.getNormalMatrix(_m);
    const c = (color === undefined ? t.color : new THREE.Color(color)).clone(); if (this.sat && this.sat !== 1) saturate(c, this.sat);
    for (let i = 0; i < t.pos.length; i += 3) {
      _v.set(t.pos[i], t.pos[i + 1], t.pos[i + 2]).applyMatrix4(_m); this.pos.push(_v.x, _v.y, _v.z);
      _v.set(t.nor[i], t.nor[i + 1], t.nor[i + 2]).applyMatrix3(_n).normalize(); this.nor.push(_v.x, _v.y, _v.z);
      this.col.push(c.r, c.g, c.b);
    }
  }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}
export { Merge, T };

const FEATURE_CELL = 192;
const BUILT = new Set(['village', 'ruins', 'tower', 'camp']);       // road, bridge, cave: in the vocabulary, not built by this POC

export class World {
  constructor(scene, rw, radius = 4) {
    this.scene = scene; this.rw = rw; this.radius = radius; this.terrain = makeTerrain(rw);
    this.chunks = new Map(); this.queue = []; this.spawn = { x: 1e9, z: 1e9 };
    this.groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: rw.flat });
    this.plantMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: rw.flat });
    this.group = new THREE.Group(); scene.add(this.group);
    const wl = this.terrain.waterLevel;
    this.water = null;
    if (wl > -1e8) {
      this.water = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK * (radius * 2 + 4), CHUNK * (radius * 2 + 4)).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0x2a6fa8, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }));   // shore wins ties: no z-fighting
      this.water.position.y = wl; scene.add(this.water);
    }
    this.stats = { built: 0, freed: 0, lastBuildMs: 0, unsupported: new Set() };
  }
  height(x, z) { return this.terrain.height(x, z); }
  /** nearest dry, gentle, OPEN spot to (px, pz) and the view direction with the least rising ground: where the player starts / lands */
  findSpawn(px = 0, pz = 0) {
    const wl = this.terrain.waterLevel, h = this.terrain.height;
    for (let r = 0; r <= 800; r += 8) {
      const n = Math.max(1, Math.round((r / 8) * 6));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, y = h(x, z);
        if (!(y > wl + 2.5 && Math.abs(h(x + 3, z) - y) + Math.abs(h(x, z + 3) - y) < 3)) continue;
        let open = true, best = { rise: 1e9, th: 0 };
        for (let k = 0; k < 16; k++) {
          const th = (k / 16) * Math.PI * 2; let rise = -1e9;
          for (const d of [6, 14, 28, 50]) rise = Math.max(rise, h(x + Math.cos(th) * d, z + Math.sin(th) * d) - y - d * 0.12);
          if (rise < best.rise) best = { rise, th };
          if (k % 4 === 0 && h(x + Math.cos(th) * 14, z + Math.sin(th) * 14) - y > 9) open = false;
        }
        if (!open) continue;
        return { x, z, yaw: Math.atan2(-Math.cos(best.th), -Math.sin(best.th)) };
      }
    }
    return { x: px, z: pz, yaw: 0 };
  }
  key(cx, cz) { return cx + ',' + cz; }

  update(px, pz, budgetMs = 6) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK), R = this.radius;
    const need = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= R * R + 1) need.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
    need.sort((a, b) => a[2] - b[2]);
    const t0 = performance.now(); let built = 0;
    for (const [cx, cz] of need) {
      if (this.chunks.has(this.key(cx, cz))) continue;
      this.chunks.set(this.key(cx, cz), this.build(cx, cz)); built++;
      if (built >= 1 || performance.now() - t0 > budgetMs) break;          // one chunk per frame
    }
    if (built) this.stats.lastBuildMs = performance.now() - t0;
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (R + 1) * (R + 1) + 1) { this.free(c); this.chunks.delete(k); this.stats.freed++; }
    }
    if (this.water) { this.water.position.x = Math.round(px / CHUNK) * CHUNK; this.water.position.z = Math.round(pz / CHUNK) * CHUNK; }   // move in chunk steps, not every frame
  }

  free(c) { this.group.remove(c.ground); c.ground.geometry.dispose(); if (c.plants) { this.group.remove(c.plants); c.plants.geometry.dispose(); } }

  build(cx, cz) {
    const rw = this.rw, h = this.terrain.height, wl = this.terrain.waterLevel, ox = cx * CHUNK, oz = cz * CHUNK;
    const nv = GRID * GRID, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const step = CHUNK / (GRID - 1), base = new THREE.Color(rw.ground), c = new THREE.Color(), e = 0.5;
    const { fbm } = this._cn || (this._cn = makeNoise(rw.seed + 7));
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const x = ox + i * step, z = oz + j * step, y = h(x, z), k = (j * GRID + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const hx = h(x + e, z) - h(x - e, z), hz = h(x, z + e) - h(x, z - e);
      const nx = -hx, ny = 2 * e, nz = -hz, l = Math.hypot(nx, ny, nz);
      nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
      const slope = 1 - ny / l, v = 0.9 + 0.2 * (fbm(x * 0.05, z * 0.05, 2) * 0.5 + 0.5);
      c.copy(base).multiplyScalar(v);
      if (y < wl + 1.4 && rw.biome !== 'swamp') c.setHex(rw.biome === 'snow' ? 0xdfe9f0 : 0xe0d19c).multiplyScalar(v);
      else if (rw.biome === 'swamp' && y < wl + 1.2) c.setHex(0x3d4a2a);
      if (slope > 0.22 && rw.biome !== 'desert') c.lerp(new THREE.Color(0x77756f), Math.min(1, (slope - 0.22) * 4));
      if (rw.biome === 'mountains' && y > rw.amplitude * 0.9) c.lerp(new THREE.Color(0xf4f6f8), Math.min(1, (y - rw.amplitude * 0.9) / 8));
      saturate(c, rw.sat); col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx = new Uint16Array((GRID - 1) * (GRID - 1) * 6); let q = 0;
    for (let j = 0; j < GRID - 1; j++) for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i, b = a + 1, d = a + GRID, f = d + 1; idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = f;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
    const ground = new THREE.Mesh(g, this.groundMat); this.group.add(ground);

    // plants + structures: one merged mesh per chunk
    const m = new Merge(); m.sat = rw.sat;
    this.plants(m, cx, cz, ox, oz, wl);
    this.features(m, cx, cz, ox, oz, wl);
    const pg = m.geometry(); let plants = null;
    if (pg) { plants = new THREE.Mesh(pg, this.plantMat); this.group.add(plants); }
    this.stats.built++;
    return { cx, cz, ground, plants };
  }

  plants(m, cx, cz, ox, oz, wl) {
    const rw = this.rw, h = this.terrain.height;
    const kinds = ['trees', 'rocks', 'grass', 'flowers', 'crystals'];
    kinds.forEach((kind, ki) => {
      const n = rw.perChunk[kind] | 0; if (!n) return;
      const rnd = mulberry32(Math.floor(hash2(rw.seed, cx * 7 + ki, cz * 13 + ki * 5) * 4294967295));
      const reps = kind === 'grass' ? 3 : 1;                                   // grass is cheap and small: more tufts
      for (let t = 0; t < n * reps; t++) {
        const x = ox + rnd() * CHUNK, z = oz + rnd() * CHUNK, y = h(x, z), a = rnd() * 6.283, s = 0.7 + rnd() * 0.8, r2 = rnd(), r3 = rnd();
        if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 6) continue;           // keep the start clear
        if (y < wl + 0.35 && !(rw.biome === 'swamp' && kind === 'trees')) continue;
        const sl = Math.abs(h(x + 1, z) - y) + Math.abs(h(x, z + 1) - y);
        if (sl > (kind === 'rocks' ? 3.2 : 1.6)) continue;
        if (kind === 'trees') {
          const crown = rw.biome === 'snow' ? 0x2f5f4a : rw.treeColor;
          if (rw.treeBox) { m.add(T.box, x, y - 0.1, z, 0.6 * s, 2.4 * s, 0.6 * s, a, 0x6b4423); m.add(T.box, x, y + 2.2 * s, z, 2.2 * s, 2.2 * s, 2.2 * s, a, new THREE.Color(crown).multiplyScalar(0.85 + r3 * 0.3)); continue; }
          m.add(T.trunk, x, y - 0.1, z, s, s, s, a); m.add(T.crown, x, y, z, s, s * (0.9 + r2 * 0.5), s, a, new THREE.Color(crown).multiplyScalar(0.85 + r3 * 0.3));
          if (rw.biome === 'snow') m.add(T.crown, x, y + 1.7 * s, z, s * 0.7, s * 0.5, s * 0.7, a, 0xf4f8fb);
        } else if (kind === 'rocks' && rw.treeBox) m.add(T.box, x, y - 0.2, z, s * (0.9 + r2), s * (0.7 + r3), s * (0.9 + r3), a, 0x8a8a85);
        else if (kind === 'rocks') m.add(T.rock, x, y - 0.15, z, s * (0.8 + r2), s * (0.6 + r3), s * (0.8 + r3), a);
        else if (kind === 'grass') m.add(T.blade, x, y - 0.05, z, s * 0.8, s * (0.6 + r2 * 0.8), s * 0.8, a, rw.biome === 'snow' ? 0xcfe3d4 : new THREE.Color(0x6fae48).multiplyScalar(0.8 + r3 * 0.4));
        else if (kind === 'flowers') m.add(T.flower, x, y, z, s, s, s, a, [0xe94b6b, 0xf2d03b, 0xffffff, 0xb06ee8][Math.floor(r2 * 4)]);
        else m.add(T.crystal, x, y - 0.1, z, s, s * (0.8 + r2 * 0.6), s, a, [0x5fe0ff, 0xb06ee8, 0x7dffb0][Math.floor(r3 * 3)]);
      }
    });
  }

  features(m, cx, cz, ox, oz, wl) {
    const rw = this.rw, h = this.terrain.height;
    for (const [fi, f] of rw.features.entries()) {
      if (!BUILT.has(f.name)) { this.stats.unsupported.add(f.name); continue; }
      const ci0 = Math.floor(ox / FEATURE_CELL) - 1, ci1 = Math.floor((ox + CHUNK) / FEATURE_CELL) + 1;
      const cj0 = Math.floor(oz / FEATURE_CELL) - 1, cj1 = Math.floor((oz + CHUNK) / FEATURE_CELL) + 1;
      for (let ci = ci0; ci <= ci1; ci++) for (let cj = cj0; cj <= cj1; cj++) {
        if (hash2(rw.seed + 977, ci * 5 + fi, cj * 3 + fi * 7) > Math.min(0.9, 0.16 * f.count)) continue;
        const x = (ci + 0.15 + hash2(rw.seed + 3, ci, cj + fi) * 0.7) * FEATURE_CELL, z = (cj + 0.15 + hash2(rw.seed + 5, ci + fi, cj) * 0.7) * FEATURE_CELL;
        if (x < ox || x >= ox + CHUNK || z < oz || z >= oz + CHUNK) continue;       // built by the chunk that holds its centre
        if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 20) continue;
        const y = h(x, z); if (y < wl + 0.8) continue;
        const rnd = mulberry32(Math.floor(hash2(rw.seed, ci * 3 + fi, cj * 11) * 4294967295));
        this.structure(m, f.name, x, y, z, rnd, h);
      }
    }
  }

  structure(m, name, x, y, z, rnd, h) {
    const hut = (px, pz, w, d, hh, wall, roof, ry) => {
      const gy = h(px, pz); m.add(T.box, px, gy - 2, pz, w, hh + 2, d, ry, wall); m.add(T.cone, px, gy + hh, pz, Math.max(w, d) * 1.25, hh * 0.7, Math.max(w, d) * 1.25, ry + Math.PI / 4, roof);
    };
    if (name === 'village') { const n = 4 + Math.floor(rnd() * 4); for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + rnd() * 0.4, r = 9 + rnd() * 9; hut(x + Math.cos(a) * r, z + Math.sin(a) * r, 4 + rnd() * 2, 4 + rnd() * 2, 2.6 + rnd(), [0xe8d9b5, 0xd9c7a0, 0xf0e6d2][i % 3], [0xa4402a, 0x7a4a21, 0x8a3b2e][i % 3], rnd() * 3); } m.add(T.cyl, x, y - 0.2, z, 2.2, 1.0, 2.2, 0, 0x9a9a95); }
    else if (name === 'tower') { m.add(T.cyl, x, y - 3, z, 5, 20, 5, 0, 0x8d8d88); m.add(T.cone, x, y + 17, z, 7, 5, 7, 0, 0x7a2f2f); }
    else if (name === 'camp') { for (let i = 0; i < 3; i++) { const a = i * 2.1 + rnd(), r = 4 + rnd() * 2; const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; m.add(T.cone, px, h(px, pz) - 0.1, pz, 3, 2.2, 3, a, [0xc0392b, 0xe6c229, 0x2f6fdb][i]); } m.add(T.cone, x, y, z, 0.7, 0.8, 0.7, 0, 0xff8a1f); }
    else if (name === 'ruins') { const n = 7 + Math.floor(rnd() * 6); for (let i = 0; i < n; i++) { const a = rnd() * 6.283, r = 3 + rnd() * 10, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; m.add(T.box, px, h(px, pz) - 1, pz, 1 + rnd() * 3.5, 1.5 + rnd() * 4, 0.7, a, 0x9a978f); } }
  }

  dispose() { for (const c of this.chunks.values()) this.free(c); this.chunks.clear(); this.scene.remove(this.group); if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); this.water.material.dispose(); } this.groundMat.dispose(); this.plantMat.dispose(); }
}
