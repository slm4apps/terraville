// SPDX-License-Identifier: Apache-2.0
// main.js -- wires the page: renderer, explore loop, prompt box, voice, spec inspector. Everything that comes from the model (or the stand-in) is a SPEC:
// validated words, shown with textContent, applied by the engine code. Nothing the model returns is ever evaluated or inserted as HTML.
import * as THREE from 'three';
import { validate, resolveWorld, TABLES, setObjectNames } from './spec.js';
import { STYLES, styleRecipe, styleLabel } from './styles.js';
import { mulberry32 } from './noise.js';
import { World, CHUNK } from './world.js';
import { Player } from './player.js';
import { Solids, Survival } from './gamekit.js';
import { Bot } from './bot.js';
import { Recorder } from './record.js';
import { Game } from './game.js';
import { parse, parseAdjust } from './parser.js';
import { askModel, DEFAULT_URL } from './model.js';
import { TinyLM } from './tinylm.js';
import { buildObject, buildRecipe, disposeObject, GOLD } from './objects.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const RADIUS = Math.max(2, Math.min(6, parseInt(params.get('radius') || '4', 10)));

const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.1, CHUNK * (RADIUS + 2));
const hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 0.7); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d6, 2.4); sun.position.set(80, 140, 60); scene.add(sun);

// the item library (recipes of popular everyday and game items, tools/lib_gen): loaded once; its names become the object vocabulary
let lib = null;
const libReady = fetch('./models/library.json').then((r) => r.json()).then((j) => { lib = j; setObjectNames([...new Set([...Object.keys(GOLD), ...j.names])]); }).catch(() => {});

// GAME MODES are data (packs/index.json): ?mode=<id> picks one; a mode names a pack (or none = free build) and its starting world.
const MODE_ID = params.get('mode') || ((params.get('replay') || params.get('selftest')) ? 'zombies' : 'free');
let zpack = null, modes = [], mode = null;
const packReady = fetch('./packs/index.json').then((r) => r.json()).then(async (j) => {
  modes = j.modes; mode = modes.find((m) => m.id === MODE_ID) || modes[0];
  if (mode.pack) { zpack = await (await fetch(`./packs/${mode.pack}.json`)).json(); mode.world ||= zpack.world; mode.try ||= zpack.try; }
});
let solids = null, survival = null, bot = null, recorder = null, mouseHeld = false;
let cur = null, world = null, player = null, game = null, tool = 'place';
const placed = [];

function say(text) { $('msg').textContent = text; }
function showSpec(res) {
  $('spec').textContent = JSON.stringify(res.spec && res.spec.style ? { ...res.spec, style: styleLabel(res.spec.style) } : res.spec, null, 1);   // display label, not the internal token
  $('via').textContent = res.via + (res.ok ? '' : ' (spec rejected: ' + (res.errors || []).join('; ') + ')');
}

function applyWorld(spec, keep = false) {
  cur = spec; const rw = resolveWorld(spec, STYLES);
  if (game) game.clear();
  if (world) world.dispose();
  world = new World(scene, rw, RADIUS);
  if (!player) player = new Player(camera, $('view'), world); else if (!keep) player.setWorld(world);
  // keep = a style / patch change during a game: stay put, unless the new world put the spot under water ("gta style"
  // made a beach + sea world and left the player out at sea for 15 s, the view was only sky and water) -> move to the nearest dry spawn.
  else { player.world = world; if (world.terrain.height(player.pos.x, player.pos.z) < world.terrain.waterLevel + 0.3) { const s = world.findSpawn(player.pos.x, player.pos.z); player.pos.x = s.x; player.pos.z = s.z; } }
  game = new Game(scene, world, player, say);
  if (keep && survival) survival.world = world;
  else {
    if (survival) { scene.remove(survival.group); if (survival.held) camera.remove(survival.held); survival = null; }
    if (solids) solids.clear();
    solids = new Solids(scene); player.solids = solids;
    if (spec.game && spec.game.game === 'survive') { survival = new Survival({ scene, camera, world, player, solids, findDesigns, say, seed: spec.seed || 1, pack: zpack }); hookSurvival(); startSession(spec); }
  }
  const sky = new THREE.Color(rw.sky ? rw.sky[spec.time === 'night' ? 1 : 0] : TABLES.sky[spec.time]);
  scene.background = sky; scene.fog = new THREE.Fog(sky, CHUNK * (RADIUS - 1.2) * rw.fog, CHUNK * (RADIUS + 0.6) * rw.fog);
  sun.intensity = TABLES.sunIntensity[spec.time] * rw.light; hemi.intensity = TABLES.ambientIntensity[spec.time];
  for (let i = 0; i < 6; i++) world.update(player.pos.x, player.pos.z, 1000);          // first ring ready before the first frame
  if (spec.game) game.start(spec.game);
  spawnExtras(rw);
  const unsup = [...world.stats.unsupported];
  say(`World: ${spec.biome}, ${spec.terrain}, water ${spec.water}, ${spec.time}.` + (spec.game ? ' ' + $('msg').textContent : ''));
  world.stats.unsupported = new Set();
  if (spec.style) say($('msg').textContent + ` Style: ${styleLabel(spec.style)}.`);
}

/** design lookup by name: exact, then a synonym, then the shortest library name that contains the words ("rifle" -> "assault rifle") */
function findDesigns(name) {
  if (!lib) return null; const n = String(name).toLowerCase();
  if (lib.recipes[n]) return lib.recipes[n];
  for (const [k, syns] of Object.entries(lib.synonyms)) if (syns.includes(n)) return lib.recipes[k];
  const words = n.split(' '), cand = lib.names.filter((k) => words.every((w) => k.split(' ').includes(w)) || k.split(' ').includes(n)).sort((a, b) => a.length - b.length);
  return cand.length ? lib.recipes[cand[0]] : null;
}

// style extras: loot to collect (library items) and a shrinking safe-zone ring (battle-royale styles); both are code, the style only names them
let extras = { items: [], got: 0, total: 0, zone: null, zoneR: 0, zc: null };
function clearExtras() {
  for (const o of extras.items) { scene.remove(o); disposeObject(o); }
  if (extras.zone) { scene.remove(extras.zone); extras.zone.geometry.dispose(); extras.zone.material.dispose(); }
  extras = { items: [], got: 0, total: 0, zone: null, zoneR: 0, zc: null };
}
function spawnExtras(rw) {
  clearExtras(); if (!lib) return;
  const rnd = mulberry32(rw.seed + 99);
  for (const [name, count] of rw.loot) {
    const designs = findDesigns(name); if (!designs) continue;
    for (let i = 0; i < count; i++) {
      const a = rnd() * 6.283, r = 18 + rnd() * 110, x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r, y = world.height(x, z);
      if (y < world.terrain.waterLevel + 0.4) continue;
      const g = buildRecipe(styleRecipe(designs[i % designs.length], rw.style), null); g.position.set(x, y, z); g.rotation.y = rnd() * 6.283; scene.add(g); extras.items.push(g);
    }
  }
  extras.total = extras.items.length;
  if (rw.zone) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 80, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
    extras.zc = { x: player.pos.x, z: player.pos.z }; extras.zoneR = 160; ring.position.set(extras.zc.x, 30, extras.zc.z); ring.scale.set(160, 1, 160); scene.add(ring); extras.zone = ring;
  }
}
function updateExtras(dt) {
  for (const o of [...extras.items]) if (Math.hypot(o.position.x - player.pos.x, o.position.z - player.pos.z) < 2.5) { scene.remove(o); disposeObject(o); extras.items.splice(extras.items.indexOf(o), 1); extras.got++; }
  if (extras.zone) { extras.zoneR = Math.max(30, extras.zoneR - dt * 0.6); extras.zone.scale.set(extras.zoneR, 1, extras.zoneR); }
}
function extrasHud() {
  let s = extras.total ? `loot ${extras.got}/${extras.total}` : '';
  if (extras.zone && Math.hypot(player.pos.x - extras.zc.x, player.pos.z - extras.zc.z) > extras.zoneR) s += ' | OUTSIDE THE ZONE';
  else if (extras.zone) s += ` | zone ${extras.zoneR.toFixed(0)} m`;
  return s;
}

function mergeSpec(base, patch) {
  const m = JSON.parse(JSON.stringify(base));
  for (const k of ['biome', 'terrain', 'water', 'time', 'seed', 'game', 'style']) if (patch[k] !== undefined) m[k] = patch[k];
  if (patch.density) m.density = { ...(m.density || {}), ...patch.density };
  if (patch.features) { m.features = m.features || []; for (const f of patch.features) { const i = m.features.findIndex((x) => x.name === f.name); if (i >= 0) m.features[i] = f; else m.features.push(f); } }
  return validate(m).spec;
}

function placeObject(spec) {
  const count = spec.count || 1, designs = findDesigns(spec.name), rnd = mulberry32((spec.name.length * 977 + count) | 0); let made = 0, parts = 0;
  for (let i = 0; i < count; i++) {
    let g = null;
    if (designs) { const d = designs[i % designs.length]; parts = d.parts.length; g = buildRecipe(styleRecipe(d, spec.style || (cur && cur.style)), spec.color); }
    else if (spec.parts) { parts = spec.parts.length; g = buildObject(spec.parts); }
    if (!g) continue;
    // big things stand further off, so a ship or a dragon is seen whole, not from inside
    const sz = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()), r = Math.max(sz.x, sz.z) / 2;
    const spread = count > 1 ? 3 + rnd() * 9 : 0, p = player.forwardPoint(5 + spread + Math.max(0, r * 1.8 - 2)), side = count > 1 ? (rnd() - 0.5) * 12 : 0;
    const x = p.x + Math.cos(player.yaw) * side, z = p.z - Math.sin(player.yaw) * side;
    g.position.set(x, world.height(x, z), z); g.rotation.y = player.yaw + (count > 1 ? rnd() * 6.283 : 0); scene.add(g); placed.push(g); made++;
  }
  say(made ? `Built ${made > 1 ? made + ' x ' : 'a '}${spec.name}${spec.color ? ' (' + spec.color + ')' : ''}${spec.style ? ', ' + styleLabel(spec.style) + ' style' : ''} (${parts} parts) in front of you.` : `I know the name "${spec.name}" but have no design for it yet.`);
}

function doTool(spec) {
  tool = spec.tool;
  if (tool === 'light') {
    const p = player.forwardPoint(3), l = new THREE.PointLight(0xffd9a0, 40, 24); l.position.set(p.x, world.height(p.x, p.z) + 2.2, p.z); scene.add(l);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2a8 })); b.position.copy(l.position); scene.add(b); placed.push(b, l);
    say('Placed a light.');
  } else if (tool === 'pickup') {
    let best = null, bd = 9; for (const o of placed) { const d = Math.hypot(o.position.x - player.pos.x, o.position.z - player.pos.z); if (d < bd) { bd = d; best = o; } }
    if (best) { scene.remove(best); disposeObject(best); placed.splice(placed.indexOf(best), 1); say('Picked it up.'); } else say('Nothing within reach.');
  } else if (tool === 'place') say('Ask for an object, e.g. "build a bench".');
  else say(`The "${tool}" tool is in the vocabulary but not in this POC.`);
}

let tiny = null;
async function getTiny() {                                  // the model is a 5.7 MB file in this folder: fetched once, run in plain JS in the page
  if (!tiny) { say('Loading the 6 MB model...'); const t0 = performance.now(); tiny = await TinyLM.load('./models/terraville-tiny', (f) => say(`Loading the model... ${(f * 100).toFixed(0)}%`)); say(`Model loaded in ${(performance.now() - t0).toFixed(0)} ms.`); }
  return tiny;
}

/** one clause -> a spec (synchronous: the in-browser model is plain JS, so a request can be answered inside the simulation step) */
/** "closest I have: X": the model always answers with a library item (a stand-in is a feature, not an error); when none of that item's names
 *  (library name or synonyms) appear in the request, say so on screen. Display only: the game never reads this. */
const stem = (w) => (w.length > 3 ? w.replace(/ies$/, 'y').replace(/(x|ch|sh)es$/, '$1').replace(/([^s])s$/, '$1') : w);
const wordsOf = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).map(stem);
function closestNote(text, name) {
  if (!text || !name) return null;
  const asked = ' ' + wordsOf(text).join(' ') + ' ', n = String(name).toLowerCase();
  const names = [n, ...((lib && lib.synonyms[n]) || []), ...(extraAliases[n] || [])], head = wordsOf(n).pop();
  return asked.includes(' ' + head + ' ') || names.some((k) => asked.includes(' ' + wordsOf(k).join(' ') + ' ')) ? null : name;
}
let closestTimer = 0, extraAliases = {};
fetch('./data/library/aliases_extra.json').then((r) => r.json()).then((j) => { extraAliases = j; }).catch(() => {});
function showClosest(text, name) {
  const el = $('closest'), c = closestNote(text, name); clearTimeout(closestTimer);
  if (!c) { el.hidden = true; return null; }
  el.textContent = `Closest I have: ${c}`; el.hidden = false; closestTimer = setTimeout(() => { el.hidden = true; }, 5000); return c;
}

function interpretSync(text) {
  let res; const src = $('src').value;
  if (src === 'tiny' && tiny) {
    try {
      const g = tiny.generate(text);
      res = g.spec ? { via: `in-browser model, ${g.ms.toFixed(0)} ms`, tokens: g.tokens, ms: g.ms, ...validate(g.spec) } : { via: 'in-browser model', tokens: g.tokens, ms: g.ms, ok: false, errors: ['no valid token sequence'], spec: null };
    } catch (e) { res = { via: 'in-browser model', ok: false, errors: [String(e)], spec: null, tokens: [], ms: 0 }; }
    if (!res.ok) { const t = res.tokens, ms = res.ms; res = parse(text, 1); res.tokens = t; res.ms = ms; res.fallback = true; }
  } else { res = parse(text, 1); res.tokens = []; res.ms = 0; }
  // numbers belong to the code: a model answer carries no seed, so the world's seed comes from the request text (same sentence = same world)
  if (res.spec && res.spec.kind === 'world' && (res.spec.seed === undefined || res.spec.seed === 1)) res.spec.seed = (Array.from(text).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0) % 100000 + 1;
  res.text = text;
  return res;
}

/** do what a spec says; returns an OUTCOME string the bot and the tests read: weapon:<class>, build:<what>, deploy:<what>, failed:scrap, world, placed, tool:<x>, say, rejected */
function applySync(res) {
  showSpec(res);
  if (!res.ok && !res.spec) { say('Could not make a spec: ' + (res.errors || []).join('; ')); return 'rejected'; }
  const s = res.spec;
  res.closest = s.kind === 'object' ? showClosest(res.text, s.name) : null;
  if (s.kind === 'adjust') { if (!survival) { say('Adjustments work while a game is running.'); return 'nothing'; } return survival.adjust(s.aspect, s.dir) ? 'patch' : 'nothing'; }
  if (survival && s.kind === 'object') { const r = survival.craft(s.name, s.count || 1); return r.ok ? r.what : 'failed:' + r.reason; }
  if (survival && (s.kind === 'world' || s.kind === 'patch')) { applyWorld(s.kind === 'world' ? { ...s, game: cur && cur.game, seed: cur && cur.seed } : mergeSpec(cur, s), true); return 'world-kept-game'; }
  let out = 'world';
  if (s.kind === 'world') applyWorld(s);
  else if (s.kind === 'patch') { if (!cur) applyWorld(validate({ kind: 'world', ...s }).spec); else applyWorld(mergeSpec(cur, s)); }
  else if (s.kind === 'object') { if (!world) applyWorld(validate({ kind: 'world' }).spec); placeObject(s); out = 'placed'; }
  else if (s.kind === 'tool') { doTool(s); out = 'tool:' + s.tool; }
  else { say(s.text || ''); out = 'say'; }
  if (!res.ok && res.errors && res.errors.length) say($('msg').textContent + ' (ignored: ' + res.errors.join('; ') + ')');
  if (world && world.stats.unsupported.size) say($('msg').textContent + ' Not built in this POC: ' + [...world.stats.unsupported].join(', ') + '.');
  return out;
}

/** a long request is cut into clauses (sentences, "then", "also", or comma groups under ~100 characters: the model reads about 112 characters), each clause is answered by the model,
 *  world / patch answers are merged into ONE world (built once), objects and tools then run in order. */
function splitRequest(text) {
  const parts = text.trim().split(/(?<=[.!?;])\s+|\s+(?:and then|then|after that|next|also)\s+/i).map((s) => s.trim()).filter(Boolean), out = [];
  for (const p of parts) {
    if (p.length <= 105) { out.push(p); continue; }
    let cur = ''; for (const c of p.split(/,\s*/)) { if (cur && (cur + ', ' + c).length > 100) { out.push(cur); cur = c; } else cur = cur ? cur + ', ' + c : c; } if (cur) out.push(cur);
  }
  return out.slice(0, 8);
}

/** a whole request, synchronously. Logged into the session (when recording) so a replay repeats it at the same simulation step. */
function handleSync(text) {
  logEvent('p', text);
  const t0 = performance.now(), clauses = splitRequest(text), outcomes = new Array(clauses.length).fill(null);
  const results = clauses.map((c) => { const ops = survival && ($('src').value !== 'tiny' || !tiny) ? parseAdjust(c) : []; return ops.length ? { adjust: ops, spec: null, tokens: [], ms: 0 } : interpretSync(c); });
  const runOne = (r) => (r.adjust ? (r.adjust.forEach((o) => survival.patch(o)), 'patch') : applySync(r));
  if (clauses.length === 1) outcomes[0] = runOne(results[0]);
  else {
    let worldSpec = null; const later = [];
    results.forEach((r, i) => {
      if (r.adjust) { outcomes[i] = runOne(r); return; }
      const s = r.spec; if (!s) { outcomes[i] = 'rejected'; return; }
      if (s.kind === 'world') { worldSpec = worldSpec ? mergeSpec(worldSpec, s) : s; outcomes[i] = 'world'; }
      else if (s.kind === 'patch') { const base = worldSpec || cur; worldSpec = base ? mergeSpec(base, s) : validate({ kind: 'world', ...s }).spec; outcomes[i] = 'world'; }
      else later.push(i);
    });
    if (worldSpec) applySync({ via: 'clauses', ok: true, errors: [], spec: worldSpec });
    for (const i of later) outcomes[i] = applySync(results[i]);
    say(`Understood ${clauses.length} parts: ` + results.map((r) => (r.spec ? r.spec.kind : '?')).join(', ') + '. ' + $('msg').textContent);
  }
  return { text, clauses, outcomes, closest: results.map((r) => r.closest || null).filter(Boolean), tokens: results.flatMap((r) => r.tokens || []), kinds: results.map((r) => (r.spec ? r.spec.kind : null)), ms: performance.now() - t0 };
}

// ---- the simulation: a FIXED time step with seeded randomness, so a recorded session replays exactly ----
const STEP = 1 / 60;
let stepNo = 0, acc = 0, session = null, replay = null, fireQueued = false, pendingPrompts = [], pendingSelect = null, replaySpeed = 1;
function startSession(spec) { stepNo = 0; acc = 0; session = { version: 1, player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch }, spec: JSON.parse(JSON.stringify(spec)), inputs: [], events: [], lastIn: null, startedAt: new Date().toISOString(), model: 'worldspec-tiny 5.7 MB, plain JS' }; }
function logEvent(type, arg) { if (session && !replay) session.events.push([stepNo, type, arg === undefined ? null : arg, player.yaw, player.pitch]); }
function hookSurvival() { if (survival && !replay) { survival.onFire = () => logEvent('f'); survival.onSelect = (i) => logEvent('s', i); } else if (survival) { survival.onFire = null; survival.onSelect = null; } }
const maskOf = () => { const k = player.keys; return (k.has('KeyW') ? 1 : 0) | (k.has('KeyS') ? 2 : 0) | (k.has('KeyA') ? 4 : 0) | (k.has('KeyD') ? 8 : 0) | (k.has('ShiftLeft') || k.has('ShiftRight') ? 16 : 0) | (k.has('Space') ? 32 : 0); };
const applyMask = (v) => { const k = player.keys; k.clear(); if (v & 1) k.add('KeyW'); if (v & 2) k.add('KeyS'); if (v & 4) k.add('KeyA'); if (v & 8) k.add('KeyD'); if (v & 16) k.add('ShiftLeft'); if (v & 32) k.add('Space'); };

function simStep() {
  stepNo++;
  if (replay) {
    while (replay.ii < replay.inputs.length && replay.inputs[replay.ii][0] <= stepNo) { const [, yaw, pitch, mk] = replay.inputs[replay.ii++]; player.yaw = yaw; player.pitch = pitch; applyMask(mk); }
    const keepYaw = player.yaw, keepPitch = player.pitch;
    while (replay.ei < replay.events.length && replay.events[replay.ei][0] <= stepNo) { const [, type, arg, yaw, pitch] = replay.events[replay.ei++]; player.yaw = yaw; player.pitch = pitch; if (type === 'p') handleSync(arg); else if (type === 'f' && survival) survival.fire(true); else if (type === 's' && survival) survival.selectWeapon(arg); }
    player.yaw = keepYaw; player.pitch = keepPitch;
  } else {
    for (const t of pendingPrompts.splice(0)) handleSync(t);                       // typed or spoken requests run INSIDE the step
    if (pendingSelect !== null && survival) { survival.selectWeapon(pendingSelect); pendingSelect = null; }
    if (bot && survival) bot.update(STEP);
    if (survival && (fireQueued || (mouseHeld && player.locked))) survival.fire();
    fireQueued = false;
    if (session) { const cur3 = [player.yaw, player.pitch, maskOf()], l = session.lastIn; if (!l || l[0] !== cur3[0] || l[1] !== cur3[1] || l[2] !== cur3[2]) { session.inputs.push([stepNo, ...cur3]); session.lastIn = cur3; } }
  }
  player.update(STEP); game.update(STEP); updateExtras(STEP); if (survival) survival.update(STEP);
}

async function saveSession(name) {
  if (!session) return null;
  const doc = { ...session, lastIn: undefined, steps: stepNo, summary: survival ? survival.summary() : null, slmReport: bot ? bot.report() : null };
  const body = JSON.stringify(doc);
  try { const r = await fetch(`http://127.0.0.1:8078/session?name=${encodeURIComponent(name)}`, { method: 'POST', body }); return await r.json(); }
  catch (e) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' })); a.download = name + '.json'; document.body.appendChild(a); a.click(); return { path: 'downloaded ' + name + '.json', bytes: body.length }; }
}
/** put the player back exactly where the recorded game began (position, view, motion) */
function restorePlayer(doc) { const s = doc.player; if (!s) return; player.pos.x = s.x; player.pos.y = s.y; player.pos.z = s.z; player.yaw = s.yaw; player.pitch = s.pitch; player.vy = 0; player.onGround = true; player.keys.clear(); }
async function startReplay(doc) {
  await libReady; await getTiny();
  bot = null; session = null; replay = { ...doc, ii: 0, ei: 0 };
  applyWorld(doc.spec); restorePlayer(doc); stepNo = 0; acc = 0; hookSurvival();
  say(`REPLAY: ${doc.steps} steps, ${doc.events.filter((e) => e[1] === 'p').length} requests. Same seed, same inputs, same game.`);
}

async function handle(text) {                          // from the box or the microphone: answered inside the next simulation step
  await libReady; if ($('src').value === 'tiny') await getTiny();
  if (replay) { say('A replay is running: it plays back a saved session. Reload for a new game.'); return null; }
  if ($('src').value === 'model') { const res = await askModel(text, $('url').value || DEFAULT_URL); applySync(res.ok ? res : parse(text, 1)); return null; }
  pendingPrompts.push(text); return null;
}

$('form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('prompt').value.trim(); if (t) handle(t); $('prompt').blur(); });
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
// HANDS-FREE voice: press V (or the Mic button) once; it keeps listening, restarts itself when the browser stops it after a pause, and sends each finished sentence like a typed request.
const voice = { on: false, rec: null, last: '' };
function updateVoiceUi() { const b = $('vbox'); b.hidden = !voice.on; $('mic').textContent = voice.on ? 'Mic on (V)' : 'Mic (V)'; $('mic').style.background = voice.on ? '#c0392b' : ''; }
function voiceHeard(t) {
  const clean = t.replace(/\b(um+|uh+|er+|erm|hmm+)\b/gi, '').replace(/\s+/g, ' ').replace(/[.,!?]+$/, '').trim();
  if (!clean) return; voice.last = 'heard: ' + clean; $('vtext').textContent = voice.last; $('prompt').value = clean; handle(clean);
}
function voiceStart() {
  if (!SR) { say('Voice input is not supported in this browser (use Chrome).'); return; }
  const r = new SR(); r.lang = 'en-US'; r.continuous = true; r.interimResults = true; voice.rec = r; voice.on = true;
  r.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript.trim(); if (e.results[i].isFinal) voiceHeard(t); else interim += t + ' '; } if (interim) $('vtext').textContent = '... ' + interim; };
  r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { voice.on = false; say('The microphone is blocked: allow it in the address bar, then press V again.'); } else if (e.error !== 'no-speech' && e.error !== 'aborted') say('Voice: ' + e.error); };
  r.onend = () => { if (voice.on) setTimeout(() => { try { r.start(); } catch (err) { /* already started */ } }, 150); updateVoiceUi(); };
  try { r.start(); } catch (err) { /* already started */ } updateVoiceUi(); say('Listening. Say what you want: "make a rifle", "build a tower", "make it harder". Press V to stop.');
}
function voiceStop() { voice.on = false; try { voice.rec && voice.rec.stop(); } catch (err) { /* stopped */ } updateVoiceUi(); say('Voice off.'); }
const voiceToggle = () => (voice.on ? voiceStop() : voiceStart());
$('mic').addEventListener('click', voiceToggle);
addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat && !(player && player.typing())) voiceToggle(); });

$('view').addEventListener('mousedown', () => { mouseHeld = true; fireQueued = true; });
addEventListener('mouseup', () => { mouseHeld = false; });
addEventListener('keydown', (e) => { if (!survival || (player && player.typing())) return; const n = parseInt(e.key, 10); if (n >= 1 && n <= 9) pendingSelect = n - 1; });

$('savesess').addEventListener('click', async () => { const r = await saveSession('session-' + Date.now()); say('Session saved: ' + JSON.stringify(r)); });
$('replayfile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) await startReplay(JSON.parse(await f.text())); });

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();


// ---- SIDE BAR: one bar on the right edge with TABS (Items, Game, Keys). New tabs are one entry in SIDE_TABS. Open/close: the ALL button or Tab. The last 5 items also sit on a small arc (bottom-right) for quick picks. ----
let wheelSig = '', sideOpen = false, sideTab = 'items';
const pickItem = (i) => { pendingSelect = i; };
const SIDE_TABS = {
  items: { label: 'Items', render(pane) { survival.weapons.forEach((x, i) => { const d = document.createElement('button'); d.className = 'pi' + (i === survival.cur ? ' sel' : ''); d.innerHTML = '<b>' + (i + 1) + '. ' + x.name + '</b><small>' + x.kind + (x.uses !== undefined ? ' x' + x.uses : '') + '</small>'; d.onclick = () => pickItem(i); pane.appendChild(d); }); } },
  game: { label: 'Game', render(pane) { pane.innerHTML = '<p>Say it or tap it:</p>'; for (const [label, say_] of (zpack && zpack.actions) || []) { const b = document.createElement('button'); b.className = 'act'; b.textContent = label; b.onclick = () => { $('prompt').value = say_; handle(say_); }; pane.appendChild(b); } } },
  keys: { label: 'Keys', render(pane) { pane.innerHTML = '<p>WASD move, Shift run, Space jump<br>Mouse: look; click = fire<br>1-9 or scroll: pick item<br>Tab: this bar<br>V: voice on/off<br>Esc: type a request</p>'; } },
};
function updateWheel() {
  const w = $('gwheel'), side = $('gside'); if (!survival) { w.hidden = true; side.hidden = true; return; } w.hidden = false; side.hidden = !sideOpen;
  const list = survival.weapons, sig = list.map((x) => x.name + (x.uses ?? '')).join('|') + '#' + survival.cur + '#' + sideOpen + sideTab; if (sig === wheelSig) return; wheelSig = sig;
  const arc = $('garc'); arc.textContent = ''; const recent = list.map((x, i) => i).slice(-8).reverse();     // newest first
  const RINGS = [{ r: 88, n: 3, step: Math.PI / 4 }, { r: 152, n: 5, step: Math.PI / 8.4 }];            // inner ring: few items close to the ALL button; outer ring: more items, further out
  let at = 0;
  for (const ring of RINGS) recent.slice(at, at + ring.n).forEach((idx, k) => {
    const off = Math.ceil(k / 2) * ring.step * (k % 2 ? 1 : -1), th = Math.PI * 1.25 + off, el = document.createElement('div');      // each ring is centred on the 225 degree diagonal, newest in the middle
    el.className = 'gi' + (idx === survival.cur ? ' sel' : ''); el.style.left = (216 + ring.r * Math.cos(th) - 26) + 'px'; el.style.top = (216 + ring.r * Math.sin(th) - 26) + 'px';
    el.innerHTML = '<b>' + (idx + 1) + '</b><span>' + list[idx].name + '</span>'; el.onclick = (e) => { e.stopPropagation(); pickItem(idx); }; arc.appendChild(el);
  }), at += ring.n;
  w.style.right = sideOpen ? '230px' : '0';
  if (sideOpen) { const tabs = $('gtabs'), pane = $('gpane'); tabs.textContent = ''; pane.textContent = ''; for (const [id, t] of Object.entries(SIDE_TABS)) { const b = document.createElement('button'); b.textContent = t.label; b.className = id === sideTab ? 'on' : ''; b.onclick = () => { sideTab = id; wheelSig = ''; }; tabs.appendChild(b); } SIDE_TABS[sideTab].render(pane); }
}
function toggleSide() { sideOpen = !sideOpen; wheelSig = ''; if (sideOpen && document.pointerLockElement) document.exitPointerLock(); }
$('gall').addEventListener('click', (e) => { e.stopPropagation(); toggleSide(); });
addEventListener('keydown', (e) => { if (e.code === 'Tab' && survival && !(player && player.typing())) { e.preventDefault(); toggleSide(); } });
addEventListener('wheel', (e) => { if (!survival || sideOpen) return; const n = survival.weapons.length; if (n > 1) pickItem((survival.cur + (e.deltaY > 0 ? 1 : n - 1)) % n); }, { passive: true });

function updateGhud() {                                 // the game HUD, live on screen (the recorder draws the same data into the video)
  const el = $('ghud'); if (!survival) { el.hidden = true; return; }
  el.hidden = false; const d = survival.hudData(), f = $('gfill');
  f.style.width = d.health + '%'; f.style.background = d.health > 50 ? '#3ddc6a' : d.health > 25 ? '#f0c030' : '#ff4040';
  $('glines').textContent = d.lines.join('\n'); $('gfeed').textContent = d.log.slice(-6).join('\n'); $('gbanner').textContent = d.banner || (replay ? 'REPLAY' : '');
  el.style.setProperty('--hurt', Math.min(0.55, d.hurt * 1.6).toFixed(2));
}
let last = performance.now(), fps = 60;
/** engine efficiency log for long runs: render side only (the simulation never reads it). One sample every 5 s; the report carries them all + a summary. */
const perf = { samples: [], frames: [], sim: 0, rend: 0, n: 0, t0: performance.now(), next: 5000 };
function perfSample(now) {
  const f = perf.frames.sort((a, b) => a - b), q = (p) => (f.length ? +f[Math.min(f.length - 1, Math.floor(p * f.length))].toFixed(1) : 0), i = renderer.info, m = performance.memory;
  let objs = 0; scene.traverse(() => objs++);
  perf.samples.push({ t: Math.round((now - perf.t0) / 1000), heap_mb: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null, frame_p50: q(0.5), frame_p95: q(0.95), frame_max: q(1), fps: +(1000 * f.length / 5000).toFixed(0),
    sim_ms: perf.n ? +(perf.sim / perf.n).toFixed(2) : 0, render_ms: perf.n ? +(perf.rend / perf.n).toFixed(2) : 0, draws: i.render.calls, tris_k: Math.round(i.render.triangles / 1000), geometries: i.memory.geometries, textures: i.memory.textures,
    scene_objects: objs, chunks: world ? world.chunks.size : 0, enemies: survival ? survival.enemies.length : 0, solids: survival ? survival.solids.boxes.length : 0 });
  perf.frames = []; perf.sim = 0; perf.rend = 0; perf.n = 0;
}
function perfSummary() {
  const S = perf.samples; if (!S.length) return null; const a = S[0], z = S[S.length - 1], mx = (k) => Math.max(...S.map((s) => s[k] ?? 0)), avg = (k) => +(S.reduce((x, s) => x + (s[k] ?? 0), 0) / S.length).toFixed(2);
  return { samples: S.length, heap_start_mb: a.heap_mb, heap_end_mb: z.heap_mb, heap_max_mb: mx('heap_mb'), geometries_start: a.geometries, geometries_end: z.geometries, textures_end: z.textures, scene_objects_end: z.scene_objects, scene_objects_max: mx('scene_objects'),
    fps_avg: avg('fps'), frame_p95_avg: avg('frame_p95'), frame_max: mx('frame_max'), sim_ms_avg: avg('sim_ms'), render_ms_avg: avg('render_ms'), draws_max: mx('draws'), tris_k_max: mx('tris_k'), enemies_max: mx('enemies'), solids_end: z.solids };
}
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); perf.frames.push(now - last); last = now; fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  if (now - perf.t0 >= perf.next) { perfSample(now); perf.next += 5000; }
  if (player && world) {
    const ts = performance.now();
    acc += dt * (replay ? replaySpeed : 1); let n = 0; while (acc >= STEP && n++ < 10 * Math.max(1, replaySpeed)) { simStep(); acc -= STEP; }
    perf.sim += performance.now() - ts; perf.n++;
    world.update(player.pos.x, player.pos.z);
    const i = renderer.info;
    $('hud').textContent = `${fps.toFixed(0)} fps | chunks ${world.chunks.size} | chunk build ${world.stats.lastBuildMs.toFixed(1)} ms | draws ${i.render.calls} | tris ${(i.render.triangles / 1000).toFixed(0)}k | ${game.hud()} ${extrasHud()}`;
    updateGhud(); updateWheel();
  }
  const shake = survival && survival.hurt > 0 ? Math.sin(stepNo * 7.3) * survival.hurt * 0.12 : 0;       // a small shake when you are hit: render only, never the simulation
  const tr = performance.now(); camera.position.x += shake; renderer.render(scene, camera); camera.position.x -= shake; perf.rend += performance.now() - tr; if (recorder) recorder.frame(); requestAnimationFrame(frame);
}
await libReady; await packReady; if (params.get('src')) $('src').value = params.get('src'); if ($('src').value === 'tiny') await getTiny();
// mode bar + "try saying" chips (all from packs/index.json and the pack): the model first, game modes as use cases on top
{ const bar = $('modes'), keep = ['src', 'seed'].map((k) => (params.get(k) ? `&${k}=${encodeURIComponent(params.get(k))}` : '')).join('');
  const link = (m, label) => `<a href="?mode=${m.id}${keep}" class="${m.id === mode.id ? 'on' : ''}" title="${m.about}">${label || m.title}</a>`;
  const free = modes.filter((m) => !m.pack), uses = modes.filter((m) => m.pack);
  bar.innerHTML = free.map((m) => link(m, 'The model')).join('') + '<span>&nbsp;use cases built on it:</span>' + uses.map((m) => link(m)).join('');
  const tr = $('try'); tr.innerHTML = '<span>try:</span>'; for (const t of mode.try || []) { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = () => { $('prompt').value = t; handle(t); }; tr.appendChild(b); } }
const startSpec = validate({ kind: 'world', ...mode.world, ...(mode.pack ? { game: { game: 'survive' } } : {}), seed: +(params.get('seed') || mode.world.seed || 7) }).spec;
applyWorld(startSpec);
const botOn = () => { if (survival) { bot = new Bot(survival, player, (t) => { $('prompt').value = t; say('BOT SAYS: "' + t + '"'); const r = handleSync(t); return { outcomes: r.outcomes, closest: r.closest, tokens: r.tokens, ms: r.ms }; }, params.get('focus') || ''); } };
if (params.get('autoplay') && survival) botOn();
// ---- SHOWCASE (?autoplay=1 in the free mode): the model on its own. Types a request every few seconds (worlds, changes, styles, items, unknowns) and records what it did. ----
const SHOWCASE = ['a snowy island at night with a lighthouse', 'add three horses', 'make it day', 'add a river', 'make it cartoon style', 'build a castle', 'spawn a dragon',
  'make a unicorn', 'a desert with ruins and cactus', 'make it voxel style', 'add a pirate ship', 'conjure a treasure chest', 'a forest with a village', 'make it night', 'add five wolves'];
const showcase = { rows: [] };
if (params.get('autoplay') && !survival) {
  (async () => {
    await getTiny(); $('src').value = 'tiny'; const gap = +(params.get('gap') || 4.5) * 1000;
    for (const t of SHOWCASE) {
      await new Promise((r) => setTimeout(r, gap)); $('prompt').value = t;
      const r = handleSync(t); showcase.rows.push({ t: +(performance.now() / 1000).toFixed(1), text: t, outcomes: r.outcomes, closest: r.closest, tokens: (r.tokens || []).join(' '), ms: Math.round(r.ms) });
    }
  })();
  const spin = () => { player.yaw += 0.0016; requestAnimationFrame(spin); }; spin();       // a slow look around for the video
}
const showcaseReport = () => (showcase.rows.length ? { total: showcase.rows.length, rows: showcase.rows } : null);
if (params.get('replay')) { const doc = await (await fetch(params.get('replay'))).json(); replaySpeed = +(params.get('speed') || 1); await startReplay(doc); }
if (params.get('record')) {
  recorder = new Recorder($('view'), () => (survival ? survival.hudData() : null), null);
  recorder.start(); const len = +(params.get('len') || 300), name = params.get('name') || MODE_ID + '-' + len + 's';
  setTimeout(async () => { const r = await recorder.stop(name); const s = await saveSession(name); document.body.dataset.zsummary = JSON.stringify({ ...(survival ? survival.summary() : {}), upload: r, session: s, slm: bot ? bot.report() : showcaseReport(), perf: perfSummary(), perf_samples: perf.samples }); fetch('http://127.0.0.1:8078/session?name=' + name + '-report', { method: 'POST', body: document.body.dataset.zsummary }).catch(() => {}); document.title = 'RECORDED'; say('RECORDED ' + JSON.stringify(r) + ' ' + JSON.stringify(s)); }, len * 1000);
} else if (params.get('autoplay') && params.get('len') && survival) {
  setTimeout(async () => { const s = await saveSession(params.get('name') || 'session'); document.body.dataset.zsummary = JSON.stringify(survival.summary()); document.title = 'DONE'; say('SUMMARY ' + JSON.stringify(survival.summary()) + ' SLM ' + JSON.stringify(bot ? { total: bot.report().total, pct: bot.report().understood_pct } : {}) + ' ' + JSON.stringify(s)); }, +params.get('len') * 1000);
}
requestAnimationFrame(frame);
// self test: run N steps with the bot (no rendering), save the session, replay it from the start and compare the two simulations step by step
if (params.get('selftest')) {
  const N = +params.get('selftest'), t0 = performance.now(); botOn();
  const prints = []; for (let i = 0; i < N; i++) { simStep(); if (i % 300 === 299) prints.push(survival.fingerprint()); }
  const doc = JSON.parse(JSON.stringify({ ...session, lastIn: undefined, steps: stepNo })), endA = survival.summary(), rep1 = bot.report();
  bot = null; session = null; replay = { ...doc, ii: 0, ei: 0 }; applyWorld(doc.spec); restorePlayer(doc); stepNo = 0; acc = 0; hookSurvival();
  const prints2 = []; for (let i = 0; i < N; i++) { simStep(); if (i % 300 === 299) prints2.push(survival.fingerprint()); }
  const endB = survival.summary(), same = JSON.stringify(prints) === JSON.stringify(prints2) && JSON.stringify(endA) === JSON.stringify(endB);
  const out = { steps: N, deterministic: same, events: doc.events.length, inputs: doc.inputs.length, first: endA, replayed: endB, slm: { total: rep1.total, understood_pct: rep1.understood_pct, by_category: rep1.by_category, failures: rep1.failures.slice(0, 8) }, ms: Math.round(performance.now() - t0) };
  document.body.dataset.selftest = JSON.stringify(out); document.title = same ? 'SELFTEST-OK' : 'SELFTEST-DIFF';
  say('SELFTEST ' + (same ? 'OK: the replay matched the original step by step. ' : 'MISMATCH. ') + JSON.stringify({ steps: N, kills: endA.kills, wave: endA.wave, requests: rep1.total, understood_pct: rep1.understood_pct }));
  console.log('SELFTEST_JSON ' + JSON.stringify(out));
  fetch('http://127.0.0.1:8078/session?name=selftest-' + N, { method: 'POST', body: JSON.stringify(out) }).catch(() => {});      // the report goes to a file, so a visible browser run can be read afterwards
}
// test hooks (headless checks): ?q=<request> runs a request on load; ?bench=1 walks 9 km and records chunk churn and memory
if (params.get('q')) { handle(params.get('q')); }
if (params.get('bench')) {
  const g0 = renderer.info.memory.geometries, t0 = performance.now(); let maxBuild = 0, sumBuild = 0, nb = 0;
  for (let n = 1; n <= 1500; n++) {
    player.pos.x += 6; player.pos.z += 0.7; player.update(1 / 60);
    const b0 = world.stats.built; world.update(player.pos.x, player.pos.z, 1000);
    if (world.stats.built > b0) { maxBuild = Math.max(maxBuild, world.stats.lastBuildMs); sumBuild += world.stats.lastBuildMs; nb++; }
    if (n % 25 === 0) renderer.render(scene, camera);
  }
  document.body.dataset.bench = JSON.stringify({ metres: Math.round(player.pos.x), chunksBuilt: world.stats.built, freed: world.stats.freed, chunksNow: world.chunks.size,
    geometries_start: g0, geometries_end: renderer.info.memory.geometries, textures: renderer.info.memory.textures, avgChunkBuildMs: +(sumBuild / Math.max(1, nb)).toFixed(1),
    maxChunkBuildMs: +maxBuild.toFixed(1), wallMs: Math.round(performance.now() - t0) });
}
window.__poc = { handle, handleSync, saveSession, startReplay, get session() { return session; }, get bot() { return bot; }, get survival() { return survival; }, get world() { return world; }, get player() { return player; }, get cur() { return cur; }, renderer, scene };

// ---- VISIBLE PROBE (?probe=1): types each prompt into the box, shows what the model answered and builds it in the world, with a live scoreboard. The same prompts as tools/probe_library.mjs. ----
if (params.get('probe')) {
  const { PROMPTS } = await import('./probe_prompts.js'); const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:12px;bottom:60px;max-width:62vw;max-height:46vh;overflow:hidden;margin:0;padding:10px 12px;background:rgba(10,14,22,.88);color:#e8eef8;font:13px ui-monospace,Menlo,monospace;border:2px solid #8ab;border-radius:8px;z-index:9;white-space:pre-wrap'; document.body.appendChild(box);
  const rows = [], names = new Set(lib ? lib.names : []), by = {}; let shown = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await getTiny(); $('src').value = 'tiny';
  for (const [cat, text, want] of PROMPTS) {
    $('prompt').value = text; const res = interpretSync(text), s = res.spec || {}, got = s.kind === 'object' ? s.name : null; applySync(res);
    const inLib = !!got && !!findDesigns(got), ok = want ? got === want : s.kind === 'object' ? inLib : true;
    rows.push({ cat, text, want, kind: s.kind || 'none', got, inLib, ok, tokens: res.tokens }); const b = (by[cat] ||= { n: 0, ok: 0, lib: 0 }); b.n++; b.ok += ok; b.lib += inLib;
    shown.push(`${ok ? 'OK  ' : 'MISS'} [${cat}] "${text}" -> ${got ? got + (inLib ? '' : ' (no designs)') : (s.kind || 'nothing')}${want && got !== want ? '   (wanted ' + want + ')' : ''}`); shown = shown.slice(-14);
    box.textContent = `PROBE ${rows.length}/${PROMPTS.length}\n` + Object.entries(by).map(([k, v]) => `${k}: ${v.ok}/${v.n} right, ${v.lib} with designs`).join('\n') + '\n\n' + shown.join('\n');
    await wait(1100);
  }
  box.textContent += '\n\nDONE'; document.title = 'PROBE-DONE'; fetch('http://127.0.0.1:8078/session?name=probe-ui', { method: 'POST', body: JSON.stringify({ rows, by }) }).catch(() => {});
}

// ---- VISIBLE DRAWINGS TEST (?drawings=1): for items the drawing model never saw, the REAL design (left) next to what the model DREW from the name (right), one pair at a time ----
if (params.get('drawings')) {
  const D = await (await fetch('./models/parts/drawings.json')).json(), box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);padding:10px 18px;background:rgba(10,14,22,.9);color:#fff;font:18px system-ui,sans-serif;border:2px solid #8ab;border-radius:10px;z-index:9;text-align:center'; document.body.appendChild(box);
  const grp = new THREE.Group(); scene.add(grp); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = { x: player.pos.x, z: player.pos.z }; player.yaw = 0; player.pitch = -0.05;
  const fit = (g) => { const bb = new THREE.Box3().setFromObject(g), s = 2.2 / Math.max(...bb.getSize(new THREE.Vector3()).toArray(), 0.01); g.scale.setScalar(s); const b2 = new THREE.Box3().setFromObject(g); g.position.y -= b2.min.y; return g; };
  let i = 0;
  for (const d of D) {
    grp.clear(); const y0 = world.height(base.x, base.z - 7);
    for (const [k, parts, dx] of [['real', d.gold, -1.8], ['model drew', d.pred, 1.8]]) { if (!parts) continue; const g = fit(buildRecipe({ parts }, null)); g.position.set(base.x + dx, g.position.y + y0, base.z - 7); grp.add(g); }
    box.innerHTML = `${++i}/${D.length} &nbsp; <b>${d.name}</b> &nbsp; <small>(${d.split === 'unseen' ? 'never trained on this name' : 'seen in training'}; asked: "${d.prompt}")</small><br><small>left: real design &nbsp; right: drawn by the model${d.pred ? '' : ' (nothing valid)'}</small>`;
    await wait(2600);
  }
  box.textContent = 'DRAWINGS DONE'; document.title = 'DRAWINGS-DONE';
}
