// SPDX-License-Identifier: Apache-2.0
// gamekit.js -- a GENERIC open-world game runtime. It knows NO game: no zombie, no scrap, no rifle, no turret. A game is a content PACK (packs/*.json) read at start-up:
// enemy archetypes (behaviour names + parameter WORDS), items with stat sheets and roles, resources, a spawn plan, and director rules (conditions on what the player has -> how the horde is weighted).
// What the code owns: entities, a registry of BEHAVIOURS and one of ROLES / BUILD SHAPES / DEPLOY KINDS, the spawner, the director, the resource ledger, HUD fields, and determinism
// (seeded RNG, fixed step, replayable). What the MODEL owns: choosing the pack / archetypes / items by words and PATCHING the live game with words (patch()).
import * as THREE from 'three';
import { buildRecipe, disposeObject } from './objects.js';
import { mulberry32 } from './noise.js';

/** blocks the player stands on and enemies attack; they have hit points (generic: any pack can build with them) */
export class Solids {
  constructor(scene) { this.scene = scene; this.boxes = []; }
  add(x0, x1, y0, y1, z0, z1, color, kind = 'block', hp = 200) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new THREE.MeshLambertMaterial({ color }));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); this.scene.add(m);
    const b = { x0, x1, y0, y1, z0, z1, mesh: m, kind, hp, hp0: hp }; this.boxes.push(b); return b;
  }
  groundAt(x, z, feetY, step = 0.65) {
    let best = -Infinity;
    for (const b of this.boxes) if (x >= b.x0 - 0.3 && x <= b.x1 + 0.3 && z >= b.z0 - 0.3 && z <= b.z1 + 0.3 && b.y1 <= feetY + step && b.y1 > best) best = b.y1;
    return best;
  }
  resolve(p, r, feetY, step = 0.65) {
    for (const b of this.boxes) {
      if (b.y1 <= feetY + step || b.y0 > feetY + 1.8) continue;
      const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1)), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
      else { const l = p.x - b.x0, rr = b.x1 - p.x, f = p.z - b.z0, bk = b.z1 - p.z, m = Math.min(l, rr, f, bk); if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === f) p.z = b.z0 - r; else p.z = b.z1 + r; }
    }
  }
  nearest(x, z, reach) {
    let best = null, bd = reach;
    for (const b of this.boxes) { const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1)), d = Math.hypot(x - cx, z - cz); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  damage(b, d) { b.hp -= d; if (b.hp <= 0) { this.remove(b); return true; } return false; }
  remove(b) { const i = this.boxes.indexOf(b); if (i >= 0) this.boxes.splice(i, 1); this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
  clear() { for (const b of [...this.boxes]) this.remove(b); }
}

// ---- engine constants (units, not game facts) ----
const BASE = { speed: 2.0, health: 30, melee: 7, reach: 1.6, hitCd: 0.9 };
const num = (x) => (typeof x === 'string' ? parseInt(x, 16) || Number(x) : x);
const MATS = {}; const mat = (c) => (MATS[c] ||= new THREE.MeshLambertMaterial({ color: c }));
const EYE = new THREE.MeshBasicMaterial({ color: 0xff2020 }), FLASH = new THREE.MeshBasicMaterial({ color: 0xff3030 });

// ---- looks: how an archetype is drawn (a name in the pack picks one) ----
// geometries are SHARED by size (enemies come and go every wave; one geometry per enemy part was never disposed and grew GPU memory)
const GEOS = {}; const boxGeo = (w, h, d) => (GEOS[`b${w},${h},${d}`] ||= new THREE.BoxGeometry(w, h, d));
const LOOKS = {
  humanoid(color, size, def = {}) {
    const g = new THREE.Group(), skin = mat(color), shirt = mat(num(def.shirt ?? 0x4a5a6a)), pants = mat(num(def.pants ?? 0x3a3a46));
    const box = (w, h, d, x, y, z, m) => { const mesh = new THREE.Mesh(boxGeo(w, h, d), m); mesh.position.set(x, y, z); g.add(mesh); return mesh; };
    box(0.22, 0.8, 0.22, -0.14, 0.4, 0, pants); box(0.22, 0.8, 0.22, 0.14, 0.4, 0, pants); box(0.55, 0.75, 0.3, 0, 1.15, 0, shirt); const head = box(0.34, 0.34, 0.34, 0, 1.72, 0, skin);
    box(0.16, 0.16, 0.7, -0.38, 1.35, 0.35, skin); box(0.16, 0.16, 0.7, 0.38, 1.35, 0.35, skin); box(0.06, 0.05, 0.03, -0.08, 1.76, 0.18, EYE); box(0.06, 0.05, 0.03, 0.08, 1.76, 0.18, EYE);
    g.scale.setScalar(size); g.userData.head = head; g.userData.skin = skin; return g;
  },
  // a swimmer: long body at the surface, dorsal fin above the water, tail; children[0] / [1] are the tail parts the walk cycle swings
  fish(color, size) {
    const g = new THREE.Group(), skin = mat(color), belly = mat(0xd8dde0);
    const box = (w, h, d, x, y, z, m) => { const mesh = new THREE.Mesh(boxGeo(w, h, d), m); mesh.position.set(x, y, z); g.add(mesh); return mesh; };
    box(0.12, 0.5, 0.45, 0, 0.1, -1.05, skin); box(0.1, 0.3, 0.3, 0, -0.15, -1.2, skin);
    const body = box(0.6, 0.5, 1.8, 0, 0, 0, skin); box(0.5, 0.18, 1.5, 0, -0.26, 0.05, belly); box(0.1, 0.55, 0.4, 0, 0.5, -0.1, skin);
    box(0.06, 0.06, 0.03, -0.22, 0.08, 0.86, EYE); box(0.06, 0.06, 0.03, 0.22, 0.08, 0.86, EYE);
    g.scale.setScalar(size); g.userData.head = body; g.userData.skin = skin; return g;
  },
};

// ---- BEHAVIOURS: small generic verbs an archetype lists by name. They read / write the per-step context c and the enemy e. ----
const BEH = {
  seek(G, e, c) { c.mx = c.dx / c.dist; c.mz = c.dz / c.dist; },
  keep_distance(G, e, c) { if (c.dist < 12) { c.mx = -c.dx / c.dist; c.mz = -c.dz / c.dist; } else if (c.dist < 20) c.speed = 0; },
  climb(G, e, c) { c.stepUp = e.def.climb || 4; },
  ranged_attack(G, e, c) {
    e.spit -= c.dt; if (e.spit > 0 || c.dist > 30) return;
    const r = G.pack.tiers.weapon_rate[e.def.ranged?.rate || 'low'] || 2.4; e.spit = 1.2 + r * 1.4;
    G.tracer(new THREE.Vector3(e.x, e.y + 1.6, e.z), new THREE.Vector3(G.player.pos.x, G.player.pos.y - 0.3, G.player.pos.z), num(e.def.ranged?.color ?? 0x9acd32));
    if (G.rnd() < 0.7) G.hurtPlayer(6 + G.wave * 0.35);
  },
  break_structure(G, e, c) {
    if (e.cd > 0) return;
    const dep = G.deployables.find((d) => Math.hypot(d.x - e.x, d.z - e.z) < 2.6), blk = G.solids.nearest(e.x, e.z, 1.4 * e.s);
    if (dep) { dep.hp -= 28 * e.dmg / BASE.melee; e.cd = 0.7; c.busy = true; if (dep.hp <= 0) G.removeDeployable(dep, 'A ' + dep.item + ' was destroyed.'); }
    else if (blk && blk.y1 > e.y + 0.6) { e.cd = 0.7; c.busy = true; if (G.solids.damage(blk, 34 * e.dmg / BASE.melee)) { G.destroyed++; G.note(`A ${blk.kind} was torn down.`); } }
  },
  slam(G, e, c) {
    e.slam -= c.dt; if (e.slam > 0 || c.dist > 7) return; e.slam = 3; G.hurtPlayer(14 + G.wave * 0.4);
    for (const b of [...G.solids.boxes]) if (Math.hypot((b.x0 + b.x1) / 2 - e.x, (b.z0 + b.z1) / 2 - e.z) < 6) if (G.solids.damage(b, 70)) G.destroyed++;
  },
  melee_attack(G, e, c) { if (!c.busy && c.dist < BASE.reach * e.s + 0.1 && Math.abs(e.y - c.feet) < 1.4 && e.cd <= 0) { G.hurtPlayer(e.dmg); e.cd = BASE.hitCd; } },
};

// ---- ROLES: what an item DOES when you make it (the item's stat sheet in the pack names its role) ----
const ROLES = {
  weapon(G, key, it, name) { G.weapons.push(G.weaponOf(key, it, name)); G.cur = G.weapons.length - 1; G.setHeld(name); },
  explosive(G, key, it, name) { G.weapons.push(G.weaponOf(key, it, name)); G.cur = G.weapons.length - 1; G.setHeld(name); },
  build(G, key, it, name, k) { BUILD[it.shape](G, it, k); G.built++; },
  deployable(G, key, it, name, k) { G.deploy(key, it, name, k); },
};
// ---- BUILD SHAPES (parameters come from the item's stat sheet) ----
const BUILD = {
  slab(G, it, k) { const f = G.forward(), p = G.player.pos, off = k * 2.2; G.slab(p.x + f.x * (3.2 + off), p.z + f.z * (3.2 + off), it.w || 4, it.d || 4, G.feetY() + (it.rise || 0.5), it.hp || 260); },
  wall(G, it, k) { const f = G.forward(), p = G.player.pos, off = k * 2.2, cx = p.x + f.x * (2.5 + off), cz = p.z + f.z * (2.5 + off), L = (it.len || 5) / 2, hw = Math.abs(f.x) < Math.abs(f.z) ? [L, 0.4] : [0.4, L]; G.solids.add(cx - hw[0], cx + hw[0], G.feetY(), G.feetY() + (it.h || 2.6), cz - hw[1], cz + hw[1], 0x9a7a52, 'wall', it.hp || 360); },
  stairs(G, it, k, andPlatform) {
    const f = G.forward(), p = G.player.pos, feet = G.feetY(), n = it.steps || 6;
    for (let i = 0; i < n; i++) { const cx = p.x + f.x * (1.5 + i), cz = p.z + f.z * (1.5 + i), hw = Math.abs(f.x) > Math.abs(f.z) ? [0.5, 1.6] : [1.6, 0.5]; G.solids.add(cx - hw[0], cx + hw[0], feet, feet + 0.5 * (i + 1), cz - hw[1], cz + hw[1], 0x9a7a52, 'stairs', it.hp || 180); }
    if (andPlatform) G.slab(p.x + f.x * (n + 3), p.z + f.z * (n + 3), 6, 6, feet + 0.5 * n, it.hp || 260);
  },
  tower(G, it, k) { BUILD.stairs(G, it, k, true); },
};
// ---- DEPLOY KINDS: what a placed item does each step ----
const DEPLOY = {
  static() {},                                                   // a placed item that just stands there (decor, a found object)
  auto_gun(G, d, dt) {
    d.cd -= dt; if (d.cd > 0) return; let best = null, bd = d.range || 45;
    for (const e of G.alive) { const r = Math.hypot(e.x - d.x, e.z - d.z); if (r < bd) { bd = r; best = e; } }
    if (best) { d.cd = 0.28; G.tracer(new THREE.Vector3(d.x, d.y, d.z), new THREE.Vector3(best.x, best.y + 1, best.z), 0x8affff); G.hitEnemy(best, 13); }
  },
  contact_blast(G, d) { if (G.alive.some((e) => Math.hypot(e.x - d.x, e.z - d.z) < 2.2)) { G.blast(d.x, d.z, d.radius || 4.5, d.damage || 90); G.removeDeployable(d); } },
};

// ---- DIRECTOR conditions: facts about the player, evaluated by name ----
const COND = {
  height_over: (G, v) => G.height() > v,
  has_role: (G, v) => G.deployables.length > 0 && G.deployables.some((d) => G.pack.items[d.item]?.role === v),
  has_shape: (G, v) => G.solids.boxes.some((b) => b.kind === v),
  weapons_at_least: (G, v) => G.weapons.filter((w) => w.role === 'weapon' && w.kind === 'gun').length >= v,
  has_item: (G, v) => G.deployables.some((d) => d.item === v) || G.weapons.some((w) => w.key === v),
  no_ranged_weapon: (G) => !G.weapons.some((w) => w.kind === 'gun'),
};
// ---- HUD fields a pack may declare ----
const HUDF = {
  goal: (G) => (G.goal ? (G.goal.done ? `DONE: ${G.goal.score}/${G.goal.list.length}` : `MAKE: ${G.goal.list[G.goal.i].toUpperCase()}  ${Math.ceil(G.goal.left)} s  SCORE ${G.goal.score}/${G.goal.i}`) : ''),
  health: (G) => `HEALTH ${Math.max(0, G.health).toFixed(0)}`, wave: (G) => `WAVE ${G.wave}`, kills: (G) => `KILLS ${G.kills}`, enemies_alive: (G) => `ALIVE ${G.alive.length}`, weapon: (G) => `WEAPON ${G.weapon.name}${G.weapon.uses !== undefined ? ' x' + G.weapon.uses : ''}`,
  height: (G) => `HEIGHT ${G.height().toFixed(1)} m`, power: (G) => `POWER ${G.power()}`, deployables: (G) => `DEPLOYED ${G.deployables.length}`, built: (G) => `BUILT ${G.solids.boxes.length}`, time: (G) => `TIME ${Math.floor(G.t / 60)}:${String(Math.floor(G.t % 60)).padStart(2, '0')}`, destroyed: (G) => `TORN DOWN ${G.destroyed}`,
};

export class GameRuntime {
  constructor({ scene, camera, world, player, solids, findDesigns, say, seed = 1, pack }) {
    Object.assign(this, { scene, camera, world, player, solids, findDesigns, say, seed, pack });
    this.group = new THREE.Group(); scene.add(this.group); this.held = null; this.log = []; this.deaths = 0; this.onFire = null; this.onSelect = null; this.step = 0; this.diff = 1; this.mods = {};
    this.start();
  }
  tier(table, word, fallback = 1) { const t = this.pack.tiers[table]; if (typeof word === 'number') return word; return t && word in t ? t[word] : fallback; }
  start() {
    for (const e of this.enemies || []) this.group.remove(e.mesh);
    for (const d of this.deployables || []) { this.group.remove(d.mesh); disposeObject(d.mesh); }
    this.solids.clear(); this.enemies = []; this.deployables = []; this.tracers = []; this.rnd = mulberry32((this.seed * 7 + 1 + this.deaths * 101) | 0);
    const P = this.pack;
    Object.assign(this, { t: 0, wave: 0, kills: 0, health: P.player.health, res: Object.fromEntries(Object.entries(P.resources).map(([k, v]) => [k, v.start])), spent: 0, crafted: [], built: 0, waveTimer: P.spawn.first_wave_delay, cd: 0, hurt: 0, dead: 0, state: 'play', destroyed: 0, kinds: {}, adapt: '', maxHeight: 0 });
    this.weapons = [this.weaponOf('start', P.player.weapon, P.player.weapon.name)]; this.cur = 0; this.setHeld(null);
    this.player.pos.y = this.world.height(this.player.pos.x, this.player.pos.z) + 1.7;
    this.goal = null;
    if (P.goals) {                                               // GOALS (generic): make the named items, one at a time, against a clock. The list is data; order is seeded.
      const list = [...P.goals.targets]; for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      this.goal = { list: list.slice(0, P.goals.count || list.length), i: 0, score: 0, left: P.goals.time || 30, missed: [], got: [] };
    }
    this.note(P.intro || 'Go.'); if (this.goal) this.note(`Make: ${this.goal.list[0]}`);
  }
  goalNext(hit) {
    const g = this.goal, want = g.list[g.i]; if (hit) { g.score++; g.got.push(want); } else g.missed.push(want);
    g.i++; g.left = this.pack.goals.time || 30; if (g.i >= g.list.length) { g.done = true; g.i = g.list.length - 1; this.note(`Finished: ${g.score} of ${g.list.length}.`); return; }
    this.note(`${hit ? 'Yes! ' : `Time! It was ${want}. `}Next: ${g.list[g.i]}`);
  }
  // generic accessors the page and the bot use
  get scrap() { return this.res[Object.keys(this.res)[0]]; } set scrap(v) { this.res[Object.keys(this.res)[0]] = v; }
  get turrets() { return this.deployables.filter((d) => d.deploy === 'auto_gun'); } get mines() { return this.deployables.filter((d) => d.deploy === 'contact_blast'); }
  get hasEnemies() { return Object.keys(this.pack.enemies || {}).length > 0; }
  get zombies() { return this.enemies; } get alive() { return this.enemies.filter((e) => e.state === 'alive'); } get weapon() { return this.weapons[this.cur]; }
  note(t) { this.log.push({ t: this.t, text: t }); if (this.log.length > 7) this.log.shift(); this.say(t); }
  feetY() { return this.player.pos.y - 1.7; } height() { return Math.max(0, this.feetY() - this.world.height(this.player.pos.x, this.player.pos.z)); }
  hurtPlayer(d) { this.health -= d; this.hurt = 0.3; }
  forward() { const p = this.player; return { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) }; }
  slab(cx, cz, w, d, top, hp) { return this.solids.add(cx - w / 2, cx + w / 2, top - 0.5, top, cz - d / 2, cz + d / 2, 0x8a6a42, 'platform', hp); }

  // ---- items: the NAME is matched against the pack's naming hints (data); the stat sheet decides what it is ----
  resolveItem(name) {
    const n = String(name).toLowerCase(), P = this.pack, order = P.naming_order || Object.keys(P.naming).filter((k) => !k.startsWith('_'));
    for (const key of order) { const hints = P.naming[key]; if (hints && hints.some((h) => new RegExp('\\b' + h + '\\b').test(n))) return key; }
    return P.fallback_item || 'melee';
  }
  weaponOf(key, it, name) {
    const W = this.pack.tiers, melee = (it.range === 'tiny');
    return { key, name, role: it.role, kind: it.role === 'explosive' ? 'grenade' : melee ? 'melee' : 'gun', dmg: W.weapon_damage[it.damage] ?? 14, range: it.role === 'explosive' ? (it.range || 18) : (W.weapon_range[it.range] ?? 20), cd: W.weapon_rate[it.rate] ?? 0.4, pellets: it.pellets, spread: it.spread, radius: it.radius, uses: it.uses, tier: it.tier || 0 };
  }
  setHeld(name) {
    if (this.held) { this.camera.remove(this.held); disposeObject(this.held); this.held = null; }
    if (!name || name === 'fists') return;
    const d = this.findDesigns(name); let g;
    if (d) { g = buildRecipe(d[0], null); const bb = new THREE.Box3().setFromObject(g), s = 0.55 / Math.max(...bb.getSize(new THREE.Vector3()).toArray(), 0.01); g.scale.setScalar(s); }
    else g = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), new THREE.MeshLambertMaterial({ color: 0x555555 }));
    g.position.set(0.3, -0.25, -0.55); g.rotation.y = Math.PI; this.camera.add(g); this.held = g;
  }
  power() {
    const D = this.pack.director.power; let p = 0;
    for (const w of this.weapons) p += (w.tier || 0) * (D.weapon_tier ?? 1);
    for (const d of this.deployables) p += (d.tier || 0.5) * (D.deployable ?? 1) * (this.pack.items[d.item]?.role === 'deployable' ? 1 : 0.5);
    p += (D.build_each ?? 0.4) * Math.min(this.solids.boxes.length, D.build_cap ?? 30); if (this.height() > (D.height_over ?? 2.2)) p += D.height_bonus ?? 2;
    return +p.toFixed(1);
  }
  /** a NAME arrives (typed, spoken, or from the model): resolve it to an item and make it. Returns { ok, what, cost, made, reason } */
  craft(name, count = 1) {
    const key = this.resolveItem(name), it = this.pack.items[key], cost = (it.cost ?? 0) * (this.mods.cost ?? 1), rname = Object.keys(this.res)[0], what = it.role === 'weapon' || it.role === 'explosive' ? 'weapon:' + key : (it.role === 'build' ? 'build:' : 'deploy:') + key;
    let made = 0;
    for (let i = 0; i < Math.min(count, 6); i++) {
      if (this.res[rname] < cost) { this.note(`Not enough ${rname} for ${name}: need ${Math.ceil(cost)}, have ${this.res[rname]}.`); break; }
      this.res[rname] -= cost; this.spent += cost; this.crafted.push(name); made++; ROLES[it.role](this, key, it, name, i);
    }
    if (made && this.goal && !this.goal.done && String(name).toLowerCase() === this.goal.list[this.goal.i]) this.goalNext(true);
    if (made) this.note(it.role === 'weapon' || it.role === 'explosive' ? `Made ${name} (${key}, ${Math.ceil(cost)} ${rname}). Left ${this.res[rname]}.` : `${it.role === 'build' ? 'Built' : 'Placed'} ${made > 1 ? made + ' x ' : 'a '}${key} (${Math.ceil(cost)} ${rname} each).`);
    return { ok: made > 0, what, cost, made, reason: made ? '' : 'resource' };
  }
  selectWeapon(i) { if (i >= 0 && i < this.weapons.length && i !== this.cur) { this.cur = i; this.setHeld(this.weapons[i].name); if (this.onSelect) this.onSelect(i); } }
  deploy(key, it, name, k) {
    // goals packs (scavenger hunt): a made thing keeps its library design's REAL size (a lighthouse is tall, a duck small) and stands off by its size, fanned left/right so the view stays clear (earlier behaviour:
    // every item was squeezed to 1.1 m and landed 2.4 m ahead on one spot). Fighting packs keep small turrets / mines close (2.4 m).
    const d = this.findDesigns(name); let m;
    if (d) { m = buildRecipe(d[0], null); if (!this.goal) { const bb = new THREE.Box3().setFromObject(m), s = (it.size ?? (it.deploy === 'contact_blast' ? 0.7 : 1.1)) / Math.max(...bb.getSize(new THREE.Vector3()).toArray(), 0.01); m.scale.setScalar(s); } }
    else m = new THREE.Mesh(it.deploy === 'contact_blast' ? new THREE.CylinderGeometry(0.4, 0.4, 0.15, 10) : new THREE.BoxGeometry(0.6, 1.0, 0.6), new THREE.MeshLambertMaterial({ color: it.deploy === 'contact_blast' ? 0x883333 : 0x445566 }));
    const sz = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()), r = Math.max(sz.x, sz.z) / 2;
    const n = this.deployables.length, far = this.goal ? 5 + Math.max(r * 1.8, sz.y * 0.9) : 2.4, a = this.goal ? ((n % 7) - 3) * 0.32 : (k - 1) * 0.9;
    const f = this.forward(), p = this.player.pos, c = Math.cos(a), sn = Math.sin(a), fx = f.x * c - f.z * sn, fz = f.x * sn + f.z * c, x = p.x + fx * far, z = p.z + fz * far;
    const y = Math.max(this.world.height(x, z), this.solids.groundAt(x, z, this.feetY()));
    m.position.set(x, y + (m.isMesh ? 0.4 : 0), z); this.group.add(m);
    this.deployables.push({ item: key, deploy: it.deploy, mesh: m, x, y: y + 1, z, life: it.life ?? 80, cd: 0, hp: it.hp ?? 90, tier: it.tier, range: it.range, radius: it.radius, damage: it.damage });
  }
  removeDeployable(d, msg) { const i = this.deployables.indexOf(d); if (i < 0) return; this.group.remove(d.mesh); disposeObject(d.mesh); this.deployables.splice(i, 1); if (msg) { this.destroyed++; this.note(msg); } }

  // ---- combat ----
  aimDir() { const p = this.player, cp = Math.cos(p.pitch); return new THREE.Vector3(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp); }
  hitEnemy(e, dmg) {
    e.hp -= dmg * (this.mods.damage ?? 1); e.flash = 0.08;
    if (e.hp <= 0 && e.state === 'alive') { e.state = 'dying'; e.dyingT = 0; this.kills++; const rn = Object.keys(this.res)[0], earn = this.pack.resources[rn].earn || {}; this.res[rn] += Math.round((earn.kill || 0) * Math.max(1, Math.sqrt(e.hp0 / (BASE.health * 2)))); this.kinds[e.type] = (this.kinds[e.type] || 0) + 1; }
  }
  tracer(a, b, color = 0xffe08a) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color })); this.group.add(l); this.tracers.push({ l, life: 0.07 }); }
  blast(x, z, r, dmg) {
    const y = Math.max(this.world.height(x, z), 0) + 0.6, s = new THREE.Mesh(new THREE.SphereGeometry(r * 0.4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.7 })); s.position.set(x, y, z); this.group.add(s); this.tracers.push({ l: s, life: 0.25 });
    for (const e of this.alive) if (Math.hypot(e.x - x, e.z - z) < r + e.r) this.hitEnemy(e, dmg);
  }
  fire(replay = false) {
    const w = this.weapon;
    if (this.state !== 'play' || this.cd > 0) return false;
    const pp0 = this.player.pos, o = new THREE.Vector3(pp0.x, pp0.y, pp0.z), d = this.aimDir();
    if (w.kind === 'melee') {
      this.cd = w.cd; const f = this.forward(); let n = 0;
      for (const e of this.alive) { const dx = e.x - this.player.pos.x, dz = e.z - this.player.pos.z, dist = Math.hypot(dx, dz); if (dist < w.range + e.r && (dx * f.x + dz * f.z) / (dist || 1) > 0.35 && Math.abs(e.y - this.feetY()) < 2) { this.hitEnemy(e, w.dmg); if (e.s < 1.5) { e.x += (dx / dist); e.z += (dz / dist); } if (++n >= 3) break; } }
    } else if (w.kind === 'grenade') {
      if (w.uses <= 0) return false; w.uses--; this.cd = w.cd; const f = this.forward(); this.blast(this.player.pos.x + f.x * w.range, this.player.pos.z + f.z * w.range, w.radius || 6, w.dmg);
    } else {
      this.cd = w.cd;
      for (let k = 0; k < (w.pellets || 1); k++) {
        const dir = d.clone(); if (w.spread) { dir.x += (this.rnd() - 0.5) * w.spread * 2; dir.y += (this.rnd() - 0.5) * w.spread * 2; dir.z += (this.rnd() - 0.5) * w.spread * 2; dir.normalize(); }
        let best = null, bt = w.range;
        for (const e of this.alive) { const v = new THREE.Vector3(e.x, e.y + e.s, e.z).sub(o), t = v.dot(dir); if (t < 0 || t > bt) continue; const perp = v.sub(dir.clone().multiplyScalar(t)).length(); if (perp < 0.6 * e.s && t < bt) { best = e; bt = t; } }
        this.tracer(o.clone().add(new THREE.Vector3(0, -0.15, 0)), o.clone().add(dir.clone().multiplyScalar(best ? bt : 45)));
        if (best) this.hitEnemy(best, w.dmg);
      }
    }
    if (!replay && this.onFire) this.onFire();
    return true;
  }

  // ---- the director: pack rules + the player's state -> enemy weights ----
  weights() {
    const P = this.pack, w = {}, why = [];
    for (const [k, T] of Object.entries(P.enemies)) if (this.wave >= (T.from_wave || 1) && !T.every_waves) w[k] = T.weight;
    for (const r of P.director.rules) { const fn = COND[r.when]; if (fn && fn(this, r.value)) { for (const [k, m] of Object.entries(r.weight)) if (k in P.enemies) w[k] = (w[k] || P.enemies[k].weight || 0.2) * m; if (r.say) why.push(r.say); } }
    this.adapt = why.join('; '); return w;
  }
  pick(w) { let tot = 0; for (const v of Object.values(w)) tot += v; let r = this.rnd() * tot; for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; } return Object.keys(w)[0]; }
  spawnWave() {
    const P = this.pack, S = P.spawn; this.wave++; const pw = this.power(), w = this.weights(), cap = S.max_alive - this.alive.length;
    const n = Math.min(cap, Math.round((S.base_count + S.per_wave * this.wave) * (1 + S.power_scale * pw) * this.diff * (this.mods.spawn ?? 1))), kinds = {}, list = [];
    for (let i = 0; i < n; i++) list.push(this.pick(w));
    for (const [k, T] of Object.entries(P.enemies)) if (T.every_waves && this.wave >= (T.from_wave || 1) && this.wave % T.every_waves === 0) for (let b = 0; b < Math.min(3, this.wave / T.every_waves); b++) list.push(k);
    const wl = this.world.terrain.waterLevel;
    for (const t of list) {
      for (let tries = 0; tries < 8; tries++) {
        const a = this.rnd() * 6.283, r = S.ring[0] + this.rnd() * (S.ring[1] - S.ring[0]), x = this.player.pos.x + Math.cos(a) * r, z = this.player.pos.z + Math.sin(a) * r, y = this.world.height(x, z);
        const def = P.enemies[t], water = def.medium === 'water';
        if (water ? y > wl - 0.8 : y < wl + 0.2) continue;                                     // swimmers start in water, walkers on land
        const size = this.tier('size', def.size), mesh = (LOOKS[def.look || 'humanoid'])(num(def.color), size, def); mesh.position.set(x, y, z); this.group.add(mesh); kinds[t] = (kinds[t] || 0) + 1;
        const hp = (S.hp_base + S.hp_per_wave * this.wave) * this.tier('health', def.health) * (1 + 0.05 * pw) * this.diff * (this.mods.health ?? 1);
        this.enemies.push({ type: t, def, mesh, x, y, z, s: size, r: 0.35 * size, hp, hp0: hp, speed: Math.min(5.2, (BASE.speed + 0.15 * this.wave) * this.tier('speed', def.speed) * (this.mods.speed ?? 1) * (0.9 + this.rnd() * 0.2)), dmg: (BASE.melee + 0.6 * this.wave) * this.tier('damage', def.damage) * (this.mods.enemy_damage ?? 1), cd: 0, state: 'alive', flash: 0, dyingT: 0, ph: this.rnd() * 6, spit: 1 + this.rnd() * 2, slam: 3 });
        break;
      }
    }
    this.note(`Wave ${this.wave}: ${list.length} (${Object.entries(kinds).map(([k, v]) => v + ' ' + k).join(', ')}). Power ${pw}.`);
    if (this.adapt) this.note(`The game adapts: ${this.adapt}.`);
  }

  /** LIVE PATCH: words from the player change the running game. The model produces these ops from speech; the engine validates and applies them. */
  patch(op) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), m = this.mods;
    if (op.op === 'difficulty') { this.diff = clamp(this.diff * (op.factor ?? 1), 0.3, 4); this.note(`Difficulty x${this.diff.toFixed(2)}.`); return true; }
    if (op.op === 'param') { m[op.name] = clamp((m[op.name] ?? 1) * (op.factor ?? 1), 0.2, 5); this.note(`${op.name} x${m[op.name].toFixed(2)}.`); return true; }
    if (op.op === 'grant') { const rn = op.resource || Object.keys(this.res)[0]; this.res[rn] = clamp((this.res[rn] || 0) + (op.n ?? 0), 0, 9999); this.note(`${rn} ${op.n >= 0 ? '+' : ''}${op.n}.`); return true; }
    if (op.op === 'spawn_now') { this.waveTimer = 0; return true; }
    return false;
  }

  /** a model-produced adjustment (aspect + direction words) -> a patch op, using this pack's numbers */
  adjust(aspect, dir) {
    const A = this.pack.adjust || {}, f = (A.factors || {})[dir] ?? 1;
    if (aspect === 'wave') { if (A.wave === 'next_goal' && this.goal && !this.goal.done) { this.goalNext(false); return true; } return this.patch({ op: 'spawn_now' }); }
    if (aspect === 'difficulty') return this.patch({ op: 'difficulty', factor: f });
    const res = (A.resource_aspects || {})[aspect]; if (res) { const n = (A.grant || {})[dir] ?? 0; return n ? this.patch({ op: 'grant', resource: res, n }) : false; }
    return this.patch({ op: 'param', name: aspect, factor: f });
  }

  update(dt) {
    this.step++; this.t += dt; this.cd = Math.max(0, this.cd - dt); this.hurt = Math.max(0, this.hurt - dt);
    if (this.state === 'dead') { this.dead -= dt; if (this.dead <= 0) this.start(); return; }
    const S = this.pack.spawn; this.waveTimer -= dt; const interval = Math.max(S.interval[0], S.interval[1] - S.interval_power * this.power());
    if (this.hasEnemies && (this.waveTimer <= 0 || (this.alive.length === 0 && this.waveTimer < interval - 8))) { this.spawnWave(); this.waveTimer = interval; }
    if (this.goal && !this.goal.done) { this.goal.left -= dt; if (this.goal.left <= 0) this.goalNext(false); }
    const pp = this.player.pos, feet = this.feetY(); this.maxHeight = Math.max(this.maxHeight, this.height());
    for (const e of this.enemies) {
      if (e.state === 'dying') { e.dyingT += dt; e.mesh.rotation.x = -Math.min(1.5, e.dyingT * 4); if (e.dyingT > 1.0) e.state = 'gone'; continue; }
      const dx = pp.x - e.x, dz = pp.z - e.z, dist = Math.hypot(dx, dz) || 1; e.ph += dt * 6; e.cd -= dt;
      const c = { dt, dx, dz, dist, feet, mx: 0, mz: 0, speed: e.speed, stepUp: 0, busy: false };
      for (const b of e.def.behaviours) if (BEH[b]) BEH[b](this, e, c);
      const wl = this.world.terrain.waterLevel, swim = e.def.medium === 'water';
      if (c.speed > 0 && dist > 1.3 * e.s && !c.busy) {
        const nx = e.x + c.mx * c.speed * dt, nz = e.z + c.mz * c.speed * dt;
        if (!swim || this.world.height(nx, nz) < wl - 0.5) { e.x = nx; e.z = nz; }                // a swimmer stops at the shore
      }
      const stand = e.y - 0.35 + c.stepUp, p2 = { x: e.x, z: e.z }; if (!swim) { this.solids.resolve(p2, 0.4 * e.s, stand); e.x = p2.x; e.z = p2.z; }
      const gy = swim ? wl - 0.25 : Math.max(this.world.height(e.x, e.z), this.solids.groundAt(e.x, e.z, stand)); e.y += (gy - e.y) * Math.min(1, dt * 12);
      e.mesh.position.set(e.x, e.y + Math.abs(Math.sin(e.ph)) * 0.05, e.z); e.mesh.rotation.y = Math.atan2(dx, dz);
      if (e.mesh.children[0]) { e.mesh.children[0].rotation.x = Math.sin(e.ph) * 0.4; e.mesh.children[1].rotation.x = -Math.sin(e.ph) * 0.4; }
      if (e.mesh.userData.head) e.mesh.userData.head.material = e.flash > 0 ? FLASH : e.mesh.userData.skin; if (e.flash > 0) e.flash -= dt;
    }
    this.enemies = this.enemies.filter((e) => { if (e.state === 'gone') { this.group.remove(e.mesh); return false; } return true; });
    for (const d of [...this.deployables]) { d.life -= dt; if (DEPLOY[d.deploy]) DEPLOY[d.deploy](this, d, dt); if (d.life <= 0 && this.deployables.includes(d)) this.removeDeployable(d); }
    for (const tr of [...this.tracers]) { tr.life -= dt; if (tr.life <= 0) { this.group.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); this.tracers.splice(this.tracers.indexOf(tr), 1); } }
    if (this.health <= 0 && this.state === 'play') { this.state = 'dead'; this.dead = 4; this.deaths++; this.note(`You died on wave ${this.wave} with ${this.kills} kills. Restarting...`); }
  }

  hudData() {
    const lines = [], per = []; for (const f of this.pack.hud) { if (f.startsWith('resource:')) { const n = f.slice(9); per.push(`${this.pack.resources[n].label} ${this.res[n]}`); } else if (HUDF[f]) per.push(HUDF[f](this)); }
    for (let i = 0; i < per.length; i += 2) lines.push(per.slice(i, i + 2).join('   '));
    return { health: Math.max(0, this.health), hurt: this.hurt, banner: this.state === 'dead' ? 'YOU DIED' : '', log: this.log.map((l) => l.text), lines };
  }
  hudLines() { return this.hudData().lines; }
  summary() { return { seconds: Math.round(this.t), wave: this.wave, kills: this.kills, killsByType: this.kinds, deaths: this.deaths, health: Math.round(this.health), power: this.power(), spent: this.spent, crafted: this.crafted, builds: this.built, destroyed: this.destroyed, maxHeight: +this.maxHeight.toFixed(1), alive: this.alive.length, difficulty: +this.diff.toFixed(2), mods: this.mods, goal: this.goal ? { score: this.goal.score, of: this.goal.i + (this.goal.done ? 1 : 0), got: this.goal.got, missed: this.goal.missed } : null }; }
  fingerprint() { let h = 0; for (const e of this.enemies) h = (h * 31 + Math.round(e.x * 100) + Math.round(e.z * 100) * 7 + Math.round(e.hp)) | 0; return [this.step, this.kills, Math.round(this.health * 100), this.scrap, this.wave, this.enemies.length, this.solids.boxes.length, h]; }
}
export const Survival = GameRuntime;
