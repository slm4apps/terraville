// SPDX-License-Identifier: Apache-2.0
// verb_probe.mjs -- are items verb-invariant? Asks the IN-BROWSER model (src/tinylm.js, int8 weights) for the same items with
// the 3 verbs HELD OUT of training (conjure, whip up, materialize) and with seen control verbs (make, add, spawn).
// A hit = kind object AND the exact library name asked. Same items for every verb, so the verbs are compared fairly.
//   node tools/verb_probe.mjs [--items 60]      -> models/verb_probe.json
import fs from 'node:fs';
import { TinyLM } from '../src/tinylm.js';
import { validate, setObjectNames } from '../src/spec.js';

const arg = (k, d) => (process.argv.includes(k) ? +process.argv[process.argv.indexOf(k) + 1] : d);
const NITEMS = arg('--items', 60);
const lib = JSON.parse(fs.readFileSync(new URL('../models/library.json', import.meta.url), 'utf8'));
setObjectNames([...new Set(['lamp', 'bench', 'hut', ...lib.names])]);
const notPop = new Set(fs.readFileSync(new URL('../data/library/maris_not_popular.txt', import.meta.url), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
const pop = lib.names.filter((n) => !notPop.has(n)).sort();
// deterministic sample: every k-th popular name
const step = Math.max(1, Math.floor(pop.length / NITEMS)), items = pop.filter((_, i) => i % step === 0).slice(0, NITEMS);

const M = new URL('../models/', import.meta.url), man = JSON.parse(fs.readFileSync(new URL('terraville-tiny.json', M), 'utf8')), buf = fs.readFileSync(new URL('terraville-tiny.bin', M));
const lm = new TinyLM(man, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const art = (w) => (/^[aeiou]/.test(w) ? 'an' : 'a');
const VERBS = { held: ['conjure', 'whip up', 'materialize'], seen: ['make', 'add', 'spawn'] };

const out = { items: items.length, by_verb: {}, held_pct: 0, seen_pct: 0, misses: [] };
const tot = { held: [0, 0], seen: [0, 0] };
for (const [group, verbs] of Object.entries(VERBS)) for (const v of verbs) {
  let hit = 0;
  for (const it of items) {
    const text = `${v} ${art(it)} ${it}`, g = lm.generate(text), r = g.spec ? validate(g.spec) : { spec: null }, s = r.spec;
    const ok = !!s && s.kind === 'object' && s.name === it; hit += ok;
    if (!ok && group === 'held' && out.misses.length < 40) out.misses.push({ text, got: s ? (s.kind === 'object' ? 'object:' + s.name : s.kind) : 'invalid' });
  }
  out.by_verb[v] = `${hit}/${items.length} (${(100 * hit / items.length).toFixed(1)} %)`;
  tot[group][0] += hit; tot[group][1] += items.length;
}
out.held_pct = +(100 * tot.held[0] / tot.held[1]).toFixed(1); out.seen_pct = +(100 * tot.seen[0] / tot.seen[1]).toFixed(1);
fs.writeFileSync(new URL('verb_probe.json', M), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, misses: out.misses.slice(0, 12) }, null, 1));
