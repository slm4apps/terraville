// SPDX-License-Identifier: Apache-2.0
// probe_library.mjs -- what does the in-browser model do with items, by category: library-backed, snapped to something else, or nothing?
//   node tools/probe_library.mjs [modelDir]      (default models/prev while a retrain is writing models/)
// For every prompt: kind/name the model returned, whether that name has DESIGNS in the library (recipes), and whether it matches the NAME we expected.
import fs from 'node:fs';
import { TinyLM } from '../src/tinylm.js';
import { validate, setObjectNames } from '../src/spec.js';
import { GOLD } from '../src/objects.js';

const dir = new URL('../' + (process.argv[2] || 'models/prev') + '/', import.meta.url), man = JSON.parse(fs.readFileSync(new URL('terraville-tiny.json', dir), 'utf8')), buf = fs.readFileSync(new URL('terraville-tiny.bin', dir));
const lm = new TinyLM(man, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LIB = JSON.parse(fs.readFileSync(new URL('../models/library.json', import.meta.url), 'utf8')), have = new Set(Object.keys(LIB.recipes || {}));
const names = new Set(LIB.names || []);
setObjectNames([...new Set([...Object.keys(GOLD), ...LIB.names])]);          // exactly what the page does after loading the library

import { PROMPTS as P } from '../src/probe_prompts.js';
const rows = [];
for (const [cat, text, want] of P) {
  const g = lm.generate(text), v = g.spec ? validate(g.spec) : { ok: false, spec: null }, s = v.spec || {};
  const got = s.kind === 'object' ? s.name : null;
  rows.push({ cat, text, want, kind: s.kind || 'none', got, count: s.count || 1, inLib: got ? have.has(got) || names.has(got) : false, exactName: want ? got === want : null, ms: Math.round(g.ms) });
}
const by = {};
for (const r of rows) { const b = (by[r.cat] ||= { n: 0, object: 0, inLib: 0, exact: 0, exactN: 0 }); b.n++; b.object += r.kind === 'object'; b.inLib += r.inLib; if (r.exactName !== null) { b.exactN++; b.exact += r.exactName; } }
const lines = ['| category | n | model answered with an item | item has library designs | matches the item asked for |', '|---|---:|---:|---:|---:|'];
for (const [k, b] of Object.entries(by)) lines.push(`| ${k} | ${b.n} | ${b.object} | ${b.inLib} | ${b.exactN ? b.exact + '/' + b.exactN : '-'} |`);
const wrong = rows.filter((r) => r.want && r.got !== r.want).map((r) => `${r.cat}: "${r.text}" -> ${r.got || r.kind}${r.got && !r.inLib ? ' (no designs)' : ''}`);
fs.writeFileSync(new URL('../models/probe_library.json', import.meta.url), JSON.stringify({ rows, by }, null, 1));
console.log(lines.join('\n') + '\n\nSnapped or missed:\n' + wrong.join('\n'));
