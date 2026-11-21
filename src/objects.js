// SPDX-License-Identifier: Apache-2.0
// objects.js -- "an object" is a list of parts in WORDS (shape, size word per axis, colour, place), exactly like the Maris3D parts words.
// The model writes the words; this file turns them into three.js meshes with metres from the TABLES in spec.js.
import * as THREE from 'three';
import { TABLES } from './spec.js';

// gold specs for the stand-in parser (and for the training data): what a correct answer looks like
export const GOLD = {
  lamp: [
    { shape: 'cylinder', size: ['small', 'tiny', 'small'], color: 'grey' },
    { shape: 'cylinder', size: ['tiny', 'large', 'tiny'], color: 'grey', place: { relation: 'on', on: 0 } },
    { shape: 'sphere', size: ['small', 'small', 'small'], color: 'yellow', place: { relation: 'on', on: 1 } },
  ],
  bench: [
    { shape: 'box', size: ['large', 'tiny', 'small'], color: 'brown' },
    { shape: 'box', size: ['large', 'small', 'tiny'], color: 'brown', place: { relation: 'on', on: 0 } },
    { shape: 'box', size: ['tiny', 'small', 'small'], color: 'black', place: { relation: 'beside', on: 0 } },
  ],
  hut: [
    { shape: 'box', size: ['huge', 'large', 'huge'], color: 'white' },
    { shape: 'cone', size: ['huge', 'medium', 'huge'], color: 'red', place: { relation: 'on', on: 0 } },
    { shape: 'box', size: ['small', 'medium', 'tiny'], color: 'brown', place: { relation: 'in_front', on: 0 } },
  ],
};

/** parts spec -> THREE.Group sitting on y = 0, origin at the first part's centre on the floor. */
export function buildObject(parts) {
  const g = new THREE.Group(), boxes = [];
  parts.forEach((p, i) => {
    const [sx, sy, sz] = p.size.map((w) => TABLES.sizeWord[w] ?? 1);
    let geo;
    if (p.shape === 'cylinder') geo = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 12);
    else if (p.shape === 'cone') geo = new THREE.ConeGeometry(sx / 2, sy, 12);
    else if (p.shape === 'sphere') geo = new THREE.SphereGeometry(Math.max(sx, sz) / 2, 12, 8).scale(1, sy / Math.max(sx, sz), 1);
    else geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: TABLES.color[p.color] ?? 0x808080 }));
    let x = 0, y = sy / 2, z = 0;
    const pl = p.place;
    if (pl && boxes[pl.on]) {
      const o = boxes[pl.on];
      x = o.x; z = o.z;
      if (pl.relation === 'on') y = o.y + o.sy / 2 + sy / 2;
      else if (pl.relation === 'beside') { x = o.x + o.sx / 2 + sx / 2; y = sy / 2; }
      else if (pl.relation === 'in_front') { z = o.z + o.sz / 2 + sz / 2; y = sy / 2; }
      else if (pl.relation === 'behind') { z = o.z - o.sz / 2 - sz / 2; y = sy / 2; }
    }
    mesh.position.set(x, y, z); g.add(mesh); boxes.push({ x, y, z, sx, sy, sz });
  });
  return g;
}

export function disposeObject(g) { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }

/** a LIBRARY recipe (metres; x right, y back, z up; part = [shape, sx, sy, sz, cx, cy, cz, color]) -> THREE.Group sitting on y = 0; `tint` recolours the largest part */
export function buildRecipe(recipe, tint) {
  const g = new THREE.Group(); let big = -1, bv = -1;
  recipe.parts.forEach((p, i) => { const v = p[1] * p[2] * p[3]; if (v > bv) { bv = v; big = i; } });
  recipe.parts.forEach((p, i) => {
    const [shape, sx, sy, sz, cx, cy, cz, color] = p; let geo;
    if (shape === 'cylinder') geo = new THREE.CylinderGeometry(Math.max(sx, sy) / 2, Math.max(sx, sy) / 2, sz, 12);
    else if (shape === 'cone') geo = new THREE.ConeGeometry(Math.max(sx, sy) / 2, sz, 12);
    else if (shape === 'uv_sphere' || shape === 'ico') geo = new THREE.SphereGeometry(0.5, 12, 8).scale(sx, sz, sy);
    else if (shape === 'torus') geo = new THREE.TorusGeometry(Math.max(sx, sy) / 2, Math.min(sx, sy, sz) / 4, 8, 16).rotateX(Math.PI / 2);
    else geo = new THREE.BoxGeometry(sx, sz, sy);
    const col = TABLES.color[tint && i === big ? tint : color] ?? 0x808080, glass = color === 'glass' || color === 'water';
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col, transparent: glass, opacity: glass ? 0.6 : 1 }));
    mesh.position.set(cx, cz, -cy); g.add(mesh);
  });
  return g;
}
