// SPDX-License-Identifier: Apache-2.0
// parser.js -- the STAND-IN for the model: plain keyword rules from a sentence to a spec. It exists so the POC works with no model at all, and it is the
// baseline the trained model must beat. It only ever produces words from VOCAB, and everything it makes goes through validate() like any other spec.
import { VOCAB, validate } from './spec.js';
import { GOLD } from './objects.js';

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const BIOME = [
  ['mountains', /\b(mountain|mountains|mountainous|alps|peaks|cliffs)\b/], ['island', /\b(island|islands|archipelago)\b/], ['beach', /\b(beach|beaches|shore|coastal|coast)\b/],
  ['swamp', /\b(swamp|marsh|bog|wetland|wetlands)\b/], ['snow', /\b(snow|snowy|arctic|icy|ice|winter|frozen|tundra)\b/], ['desert', /\b(desert|dunes|sahara|arid)\b/],
  ['forest', /\b(forest|woods|woodland|jungle|trees)\b/], ['grassland', /\b(grassland|meadow|meadows|plains|prairie|fields|field|grassy|green)\b/],
];
const PLANT = [['trees', /\b(trees?|forest|woods)\b/], ['rocks', /\b(rocks?|stones?|boulders?)\b/], ['grass', /\bgrass\b/], ['flowers', /\bflowers?\b/], ['crystals', /\b(crystals?|gems?)\b/]];
const DENSE = /\b(dense|densely|thick|lots of|many|packed|crowded|more)\b/, SPARSE = /\b(sparse|sparsely|few|scattered|fewer|less|thin)\b/, NONE = /\b(no|without|remove all)\b/;
const FEATURE = [['village', /\b(village|villages|town|hamlet)\b/], ['ruins', /\b(ruins?|ruined|remains)\b/], ['road', /\b(road|roads|path|paths)\b/], ['bridge', /\b(bridge|bridges)\b/],
  ['tower', /\b(tower|towers|lighthouse)\b/], ['camp', /\b(camp|camps|campsite|tents?)\b/], ['cave', /\b(cave|caves|cavern)\b/]];

function count(text, m) {
  const before = text.slice(Math.max(0, m.index - 14), m.index).trim().split(/\s+/).pop() || '';
  if (/^\d+$/.test(before)) return Math.min(8, parseInt(before, 10));
  return NUM[before] ? Math.min(8, NUM[before]) : 1;
}

const STYLE = [['minecraft', /\b(minecraft|voxel|cube world|blocky)\b/], ['roblox', /\b(roblox|lego|brick toy)\b/], ['gta', /\b(gta|grand theft auto|vice city)\b/], ['pubg', /\b(pubg|battle royale|erangel|warzone)\b/],
  ['fortnite', /\bfortnite\b/], ['zelda', /\b(zelda|breath of the wild)\b/], ['mario', /\b(mario|platformer)\b/], ['cyberpunk', /\b(cyberpunk|neon city|blade runner)\b/], ['medieval', /\b(medieval|middle ages)\b/],
  ['western', /\b(wild west|western|cowboy)\b/], ['apocalypse', /\b(apocalypse|apocalyptic|wasteland|fallout)\b/], ['cartoon', /\b(cartoon|toon|cel shaded)\b/], ['lowpoly', /\b(low[- ]?poly)\b/], ['realistic', /\b(realistic|photorealistic|lifelike)\b/]];

function worldFields(t, out, patch) {
  for (const [s, re] of STYLE) if (re.test(t)) { out.style = s; break; }
  for (const [b, re] of BIOME) if (re.test(t)) { out.biome = b; break; }
  if (/\b(lake|lakes|pond)\b/.test(t)) out.water = 'lake'; else if (/\b(river|rivers|stream|creek)\b/.test(t)) out.water = 'river';
  else if (/\b(sea|ocean|coast|coastal|beach|island|islands)\b/.test(t)) out.water = 'sea'; else if (/\b(no water|dry)\b/.test(t)) out.water = 'none';
  if (/\b(steep|rugged|jagged|mountainous|cliffs)\b/.test(t)) out.terrain = 'steep'; else if (/\b(flat|level|plain)\b/.test(t)) out.terrain = 'flat';
  else if (/\b(hill|hills|hilly|rolling)\b/.test(t)) out.terrain = 'hilly';
  if (/\b(night|dark|midnight|moonlit|moon)\b/.test(t)) out.time = 'night'; else if (/\b(day|daytime|sunny|bright|noon)\b/.test(t)) out.time = 'day';
  const dens = {};
  for (const [p, re] of PLANT) {
    const m = t.match(re); if (!m) continue;
    const win = t.slice(Math.max(0, m.index - 22), m.index + m[0].length + 12);
    if (NONE.test(win.slice(0, win.indexOf(m[0]) + 1)) && /\b(no|without)\s+(\w+\s+)?$/.test(t.slice(0, m.index + 0).slice(-14) + ' ')) dens[p] = 'none';
    else if (SPARSE.test(win)) dens[p] = 'sparse'; else if (DENSE.test(win) && !(patch && p === 'trees' && /forest/.test(m[0]) && !DENSE.test(win))) dens[p] = 'dense';
  }
  if (Object.keys(dens).length) out.density = dens;
  const feats = [];
  for (const [name, re] of FEATURE) { const m = t.match(re); if (m) feats.push({ name, count: count(t, m) }); }
  if (feats.length) out.features = feats;
  const g = t.match(/\b(collect|find|gather|hunt for)\s+(\d+|\w+)?\s*(crystals?|gems?|flowers?|rocks?|stones?|trees?)\b/);
  if (g) { const n = /^\d+$/.test(g[2] || '') ? parseInt(g[2], 10) : NUM[g[2]] || 5; const tg = /crystal|gem/.test(g[3]) ? 'crystals' : /flower/.test(g[3]) ? 'flowers' : /tree/.test(g[3]) ? 'trees' : 'rocks'; out.game = { game: 'collect', target: tg, count: n }; }
  else if (/\brace\b/.test(t)) out.game = { game: 'race' }; else if (/\b(surviv|zombie|zombies|horde|undead)/.test(t)) { out.game = { game: 'survive' }; if (!out.style) out.style = 'apocalypse'; }
}

export function parse(text, seedHint = 1) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9\s,.'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { via: 'stand-in', ...validate({ kind: 'say', text: 'Say what kind of world, object or game you want.' }) };
  // tools
  const tool = /\b(dig|pick ?up|pickup|grab)\b/.exec(t) ? (/dig/.test(t) ? 'dig' : 'pickup') : /\b(light|torch|lamp post)\b/.test(t) && /\b(add|place|put|drop|make)\b/.test(t) && !/\b(world|forest|desert|village)\b/.test(t) ? 'light' : /^(place|drop|put)\b.*\b(it|object|that|this)\b/.test(t) ? 'place' : null;
  if (tool) return { via: 'stand-in', ...validate({ kind: 'tool', tool, size: /\b(big|large|huge|wide)\b/.test(t) ? 'large' : /\b(small|tiny|little)\b/.test(t) ? 'small' : 'medium' }) };
  // object
  const obj = /\b(lamp|lantern|streetlight|bench|seat|hut|cabin|house)\b/.exec(t);
  if (obj && /\b(build|make|create|give|add|put|place)\b/.test(t) && !/\b(world|land|forest|desert|island|mountains?|swamp|snow|village|game)\b/.test(t)) {
    const name = /lamp|lantern|streetlight/.test(obj[0]) ? 'lamp' : /bench|seat/.test(obj[0]) ? 'bench' : 'hut';
    const parts = JSON.parse(JSON.stringify(GOLD[name]));
    const col = VOCAB.color.find((c) => new RegExp('\\b' + c + '\\b').test(t));
    if (col) parts[0].color = col;
    return { via: 'stand-in', ...validate({ kind: 'object', name, parts }) };
  }
  // patch ("make it denser", "more rocks", "at night", "add a lake")
  const isPatch = /^(make it|make the|make this|more |less |fewer |add more|add a |add some|turn it|change|now |and |also |at night|during)/.test(t) && !/\b(world|land)\b/.test(t);
  const out = { kind: isPatch ? 'patch' : 'world' };
  worldFields(t, out, isPatch);
  if (!isPatch) { if (!out.biome) out.biome = /\b(forest|trees)\b/.test(t) ? 'forest' : 'grassland'; out.seed = (Array.from(t).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0) % 100000 + seedHint; }
  const r = validate(out);
  if (isPatch && Object.keys(out).length === 1) return { via: 'stand-in', ...validate({ kind: 'say', text: 'I did not understand that change.' }) };
  return { via: 'stand-in', ...r };
}

/** live-game ADJUSTMENTS in words ("make it harder", "zombies faster", "more scrap", "next wave") -> patch ops for the running game.
 *  This is the rule-based STAND-IN: the model learns these as tokens next, the engine's patch() stays the same. */
export function parseAdjust(text) {
  const t = String(text).toLowerCase(), ops = [];
  if (/\b(harder|tougher|more difficult|more dangerous|hardcore|nightmare|crank it up)\b/.test(t)) ops.push({ op: 'difficulty', factor: /\b(much|way|nightmare|hardcore)\b/.test(t) ? 1.6 : 1.25 });
  else if (/\b(easier|less difficult|calmer|go easy|easy mode|too hard)\b/.test(t)) ops.push({ op: 'difficulty', factor: /\b(much|way)\b/.test(t) ? 0.5 : 0.8 });
  if (/\b(zombies|enemies|they)( are| get| become| run)? faster\b|\bfaster (zombies|enemies)\b|\bspeed them up\b/.test(t)) ops.push({ op: 'param', name: 'speed', factor: 1.25 });
  if (/\b(zombies|enemies|they)( are| get| become)? slower\b|\bslower (zombies|enemies)\b|\bslow them down\b/.test(t)) ops.push({ op: 'param', name: 'speed', factor: 0.8 });
  if (/\b(tougher|stronger|beefier) (zombies|enemies)\b|\b(zombies|enemies)( are| get)? (tougher|stronger)\b/.test(t)) ops.push({ op: 'param', name: 'health', factor: 1.4 });
  if (/\bmore (zombies|enemies)\b|\bspawn (more|faster)\b/.test(t)) ops.push({ op: 'param', name: 'spawn', factor: 1.3 });
  if (/\b(fewer|less) (zombies|enemies)\b/.test(t)) ops.push({ op: 'param', name: 'spawn', factor: 0.75 });
  const m = t.match(/\b(?:give me|i need|more|add) (\d+ )?(scrap|resources|materials)\b/);
  if (m) ops.push({ op: 'grant', n: Math.min(200, m[1] ? parseInt(m[1], 10) : 40) });
  if (/\b(next wave|send the next|start the next wave|bring the next wave)\b/.test(t)) ops.push({ op: 'spawn_now' });
  return ops;
}
