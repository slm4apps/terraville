// SPDX-License-Identifier: Apache-2.0
// spec.js -- the contract between the MODEL (words) and the CODE (numbers). Pure ES module: runs in the browser and in node.
// The model only ever chooses words from the closed lists below. Everything numeric lives in the tables in this file and is applied by the engine.
// A spec coming from ANY source (stand-in parser, trained model, user paste) goes through validate() first: it is treated as untrusted input.

export const VOCAB = {
  biome: ['forest', 'desert', 'snow', 'grassland', 'mountains', 'swamp', 'beach', 'island'],
  water: ['none', 'lake', 'river', 'sea'],
  terrain: ['flat', 'hilly', 'steep'],
  time: ['day', 'night'],
  density: ['none', 'sparse', 'normal', 'dense'],
  plants: ['trees', 'rocks', 'grass', 'flowers', 'crystals'],
  feature: ['village', 'ruins', 'road', 'bridge', 'tower', 'camp', 'cave'],
  game: ['collect', 'race', 'survive', 'build'],
  tool: ['dig', 'place', 'light', 'pickup'],
  toolSize: ['small', 'medium', 'large'],
  target: ['crystals', 'flowers', 'rocks', 'trees'],
  object: ['lamp', 'bench', 'hut'],                          // the POC builds 3 objects; the part-list format is the same for any number
  shape: ['box', 'cylinder', 'cone', 'sphere'],
  sizeWord: ['tiny', 'small', 'medium', 'large', 'huge'],
  color: ['red', 'green', 'blue', 'yellow', 'brown', 'grey', 'white', 'black', 'orange', 'pink'],
  place: ['on', 'beside', 'in_front', 'behind'],
  style: ['minecraft', 'roblox', 'gta', 'pubg', 'fortnite', 'zelda', 'mario', 'cyberpunk', 'medieval', 'western', 'apocalypse', 'cartoon', 'lowpoly', 'realistic'],
  kind: ['world', 'patch', 'object', 'tool', 'say', 'adjust'],
  aspect: ['difficulty', 'speed', 'health', 'damage', 'spawn', 'scrap', 'wave'],       // live game adjustments: WHAT to change ...
  dir: ['up', 'down', 'much_up', 'much_down'],                                          // ... and which way. The running game's pack says what each means.
};

// the fixed things the model can SAY (it picks an id; the words are code's)
/** the object names the page can build: the 3 gold ones, plus every name of the loaded library (setObjectNames) */
export function setObjectNames(names) { VOCAB.object.length = 0; VOCAB.object.push(...names); }

export const SAY_MESSAGES = [
  'Hi! Tell me a world, an object or a small game to make.',
  'I can make worlds, simple objects and small games like collecting things.',
  'I only make worlds, objects and simple games.',
  'I cannot build that yet. Try a village, a tower, a camp or ruins.',
  'I cannot build that yet. Try a lamp, a bench or a hut.',
  'You are welcome.',
  'I can only make or change worlds and objects.',
  'I cannot play music.',
  'I turn your words into worlds, objects and simple games.',
  'I cannot save yet.',
  'I cannot do multiplayer yet.',
  'Tell me what to make next.',
];

// ---- word -> number tables (the code owns every number; the model never writes one except counts) ----
export const TABLES = {
  amplitude: { flat: 2.5, hilly: 14, steep: 34 },            // metres of terrain relief
  frequency: { flat: 0.006, hilly: 0.012, steep: 0.02 },     // 1 / metres of the base noise
  instancesPerChunk: { none: 0, sparse: 6, normal: 20, dense: 56 },
  sizeWord: { tiny: 0.3, small: 0.6, medium: 1.0, large: 1.8, huge: 3.2 },   // metres per side
  toolRadius: { small: 1.5, medium: 3, large: 6 },
  sky: { day: 0x9ad0f0, night: 0x0b1530 },
  sunIntensity: { day: 2.4, night: 0.25 },
  ambientIntensity: { day: 0.7, night: 0.18 },
  color: { blue: 0x2f6fdb, brass: 0xb5a642, brick: 0xa4402a, cream: 0xf0e6c8, glass: 0xaedcf0, metal: 0x9aa3ab, navy: 0x1d2b5a, oak: 0xb08850, pine: 0xd2b27a, rust: 0xa5502a, skin: 0xe0b48f, snow: 0xf4f8fb, teal: 0x2a9d8f, terra: 0xc26a45, timber: 0x8a6a42, walnut: 0x5a3a22, water: 0x2a6fa8, red: 0xc0392b, green: 0x2e8b3a, blue: 0x2f6fdb, yellow: 0xe6c229, brown: 0x7a4a21, grey: 0x808080, white: 0xf2f2f2, black: 0x1a1a1a, orange: 0xe67e22, pink: 0xe68fb0 },
  biome: {   // ground colour, tree colour, default tree density bias, sea-level bias
    forest:    { ground: 0x3f7a35, tree: 0x1f5f2a, trees: 'dense',  rocks: 'sparse', grass: 'normal', flowers: 'sparse', crystals: 'none', relief: 1.0 },
    desert:    { ground: 0xd9bf7a, tree: 0x7a8a3a, trees: 'none',   rocks: 'normal', grass: 'none',   flowers: 'none',   crystals: 'none', relief: 0.8 },
    snow:      { ground: 0xf0f4f8, tree: 0x2f5f4a, trees: 'sparse', rocks: 'normal', grass: 'none',   flowers: 'none',   crystals: 'sparse', relief: 1.1 },
    grassland: { ground: 0x6fae48, tree: 0x2e7d32, trees: 'sparse', rocks: 'sparse', grass: 'dense',  flowers: 'normal', crystals: 'none', relief: 0.8 },
    mountains: { ground: 0x7d7d78, tree: 0x2b5a35, trees: 'sparse', rocks: 'dense',  grass: 'sparse', flowers: 'none',   crystals: 'sparse', relief: 1.7 },
    swamp:     { ground: 0x4c5a32, tree: 0x37502c, trees: 'normal', rocks: 'sparse', grass: 'normal', flowers: 'none',   crystals: 'none', relief: 0.5 },
    beach:     { ground: 0xe3d3a1, tree: 0x3f8f3f, trees: 'sparse', rocks: 'sparse', grass: 'none',   flowers: 'none',   crystals: 'none', relief: 0.4 },
    island:    { ground: 0x7ab356, tree: 0x2e7d32, trees: 'normal', rocks: 'sparse', grass: 'normal', flowers: 'sparse', crystals: 'none', relief: 1.0 },
  },
};

// ---- limits: a spec cannot blow up memory or frame time, whoever wrote it ----
export const LIMITS = { specBytes: 4096, featureCount: 8, features: 8, parts: 12, gameCount: 30, seed: 2147483647 };

const inList = (list, v) => list.includes(v);

/** validate(spec) -> { ok, errors, spec }. `spec` is a CLEAN copy: unknown keys dropped, numbers clamped. Never throws. */
export function validate(input) {
  const errors = [];
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.specBytes) return { ok: false, errors: ['spec too long'], spec: null };
    try { raw = JSON.parse(raw); } catch (e) { return { ok: false, errors: ['not json'], spec: null }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['not an object'], spec: null };
  if (JSON.stringify(raw).length > LIMITS.specBytes) return { ok: false, errors: ['spec too long'], spec: null };
  const kind = raw.kind;
  if (!inList(VOCAB.kind, kind)) return { ok: false, errors: [`kind ${JSON.stringify(kind)}`], spec: null };
  const out = { kind };
  const word = (key, list, dflt, src = raw, dst = out) => {
    const v = src[key];
    if (v === undefined || v === null) { if (dflt !== undefined) dst[key] = dflt; return; }
    if (!inList(list, v)) { errors.push(`${key}: ${JSON.stringify(v)}`); if (dflt !== undefined) dst[key] = dflt; return; }
    dst[key] = v;
  };
  const int = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt; };

  if (kind === 'world' || kind === 'patch') {
    const dflt = kind === 'world';
    word('biome', VOCAB.biome, dflt ? 'grassland' : undefined);
    word('terrain', VOCAB.terrain, dflt ? 'hilly' : undefined);
    word('water', VOCAB.water, dflt ? 'none' : undefined);
    word('time', VOCAB.time, dflt ? 'day' : undefined);
    word('style', VOCAB.style, undefined);
    if (raw.density && typeof raw.density === 'object') {
      out.density = {};
      for (const p of VOCAB.plants) if (raw.density[p] !== undefined) word(p, VOCAB.density, undefined, raw.density, out.density);
      for (const k of Object.keys(raw.density)) if (!inList(VOCAB.plants, k)) errors.push(`density.${k}`);
    }
    if (Array.isArray(raw.features)) {
      out.features = [];
      for (const f of raw.features.slice(0, LIMITS.features)) {
        if (!f || !inList(VOCAB.feature, f.name)) { errors.push(`feature ${JSON.stringify(f && f.name)}`); continue; }
        out.features.push({ name: f.name, count: int(f.count, 1, LIMITS.featureCount, 1) });
      }
    }
    if (raw.game) {
      const g = raw.game;
      if (!inList(VOCAB.game, g.game)) errors.push(`game ${JSON.stringify(g.game)}`);
      else {
        out.game = { game: g.game };
        if (g.game === 'collect') {
          out.game.target = inList(VOCAB.target, g.target) ? g.target : 'crystals';
          out.game.count = int(g.count, 1, LIMITS.gameCount, 5);
        }
      }
    }
    if (dflt) out.seed = int(raw.seed, 0, LIMITS.seed, 1);
    else if (raw.seed !== undefined) out.seed = int(raw.seed, 0, LIMITS.seed, 1);
  } else if (kind === 'object') {
    word('name', VOCAB.object, undefined);
    word('style', VOCAB.style, undefined);
    if (!out.name) errors.push('object name');
    if (raw.count !== undefined) out.count = int(raw.count, 1, 30, 1);
    if (typeof raw.color === 'string') { if (inList(VOCAB.color, raw.color)) out.color = raw.color; else errors.push('color ' + raw.color); }
    if (!Array.isArray(raw.parts) || raw.parts.length === 0) { if (!out.name) errors.push('object parts'); }
    else {
      out.parts = [];
      for (const p of raw.parts.slice(0, LIMITS.parts)) {
        const q = {};
        word('shape', VOCAB.shape, 'box', p, q);
        word('color', VOCAB.color, 'grey', p, q);
        const size = Array.isArray(p.size) ? p.size.slice(0, 3) : [];
        q.size = [0, 1, 2].map((i) => (inList(VOCAB.sizeWord, size[i]) ? size[i] : 'medium'));
        if (p.place && typeof p.place === 'object') {
          q.place = {};
          word('relation', VOCAB.place, 'on', p.place, q.place);
          q.place.on = int(p.place.on, 0, LIMITS.parts - 1, 0);
        }
        out.parts.push(q);
      }
    }
  } else if (kind === 'tool') {
    word('tool', VOCAB.tool, undefined);
    if (!out.tool) errors.push('tool');
    word('size', VOCAB.toolSize, 'medium');
  } else if (kind === 'adjust') {
    word('aspect', VOCAB.aspect, undefined); word('dir', VOCAB.dir, 'up');
    if (!out.aspect) errors.push('aspect');
  } else if (kind === 'say') {
    out.text = typeof raw.text === 'string' ? raw.text.slice(0, 200) : '';
  }
  // a spec with an unknown WORD is rejected (not repaired): the model is scored on exact words
  const fatal = errors.filter((e) => !e.startsWith('density.') );
  return { ok: fatal.length === 0 && errors.length === 0, errors, spec: out };
}

/** the world spec with every default filled (density from the biome, etc.) -> the numbers the engine uses. */
export function resolveWorld(spec, styles) {
  const st = spec.style && styles ? styles[spec.style] : null;
  if (st) { spec = { ...spec }; if (st.biome && (!spec.biome || spec.biome === 'grassland')) spec.biome = st.biome; if (st.water && (!spec.water || spec.water === 'none')) spec.water = st.water; if (st.features && !(spec.features && spec.features.length)) spec.features = st.features; }
  const b = TABLES.biome[spec.biome] || TABLES.biome.grassland;
  const dens = {};
  for (const p of VOCAB.plants) dens[p] = (spec.density && spec.density[p]) || b[p];
  return {
    biome: spec.biome, ground: b.ground, treeColor: b.tree,
    amplitude: TABLES.amplitude[spec.terrain] * b.relief, frequency: TABLES.frequency[spec.terrain],
    water: spec.water, time: spec.time,
    perChunk: Object.fromEntries(VOCAB.plants.map((p) => [p, TABLES.instancesPerChunk[dens[p]]])),
    features: spec.features || [], game: spec.game || null, seed: spec.seed ?? 1, style: spec.style || null,
    voxel: st?.voxel || 0, flat: !!st?.flat, sat: st?.sat ?? 1, light: st?.light ?? 1, treeBox: !!st?.treeBox, sky: st?.sky || null, fog: st?.fog ?? 1, loot: st?.loot || [], zone: !!st?.zone,
  };
}
