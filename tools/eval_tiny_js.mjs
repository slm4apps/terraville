// SPDX-License-Identifier: Apache-2.0
// eval_tiny_js.mjs -- scores the IN-BROWSER model (src/tinylm.js on the int8 weights, plain JS) and the rule-based stand-in on the SAME sentences
// (data/tiny/test.jsonl: seen phrasing / held-out phrasing / held-out synonyms). Exact = the whole spec equal (seed aside); field = per-field match.
//   node tools/eval_tiny_js.mjs [--limit N]
import fs from 'node:fs';
import { TinyLM } from '../src/tinylm.js';
import { validate, setObjectNames } from '../src/spec.js';
import { parse } from '../src/parser.js';

const LIBN = JSON.parse(fs.readFileSync(new URL('../models/library.json', import.meta.url), 'utf8')).names; setObjectNames([...new Set(['lamp', 'bench', 'hut', ...LIBN])]);     // the page does this after loading the library
const lim = process.argv.includes('--limit') ? +process.argv[process.argv.indexOf('--limit') + 1] : 1e9;
const M = new URL('../models/', import.meta.url), man = JSON.parse(fs.readFileSync(new URL('terraville-tiny.json', M), 'utf8')), buf = fs.readFileSync(new URL('terraville-tiny.bin', M));
const lm = new TinyLM(man, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const rows = fs.readFileSync(new URL('../data/tiny/test.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).slice(0, lim);
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const strip = (s) => { if (!s) return s; const c = JSON.parse(JSON.stringify(s)); delete c.seed; return canon(c); };
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const B = {}, bucket = (k) => (B[k] ||= { model: { n: 0, exact: 0, valid: 0, fh: 0, ft: 0 }, standin: { n: 0, exact: 0, valid: 0, fh: 0, ft: 0 } });
let ms = 0;
for (const r of rows) {
  const gold = strip(r.spec), g = lm.generate(r.text); ms += g.ms;
  const mv = g.spec ? validate(g.spec) : { ok: false, spec: null }, sp = parse(r.text);
  for (const [who, v] of [['model', mv], ['standin', sp]]) {
    const s = v.spec ? strip(v.spec) : null, fields = Object.keys(gold).filter((k) => k !== 'kind'), hit = s ? fields.filter((k) => eq(s[k], gold[k])).length : 0;
    for (const key of ['all', r.split, 'kind:' + r.kind]) { const b = bucket(key)[who]; b.n++; b.exact += s && eq(s, gold) ? 1 : 0; b.valid += v.ok ? 1 : 0; b.fh += hit; b.ft += fields.length; }
  }
}
const pc = (a, b) => (b ? +(100 * a / b).toFixed(1) : 0);
const out = Object.fromEntries(Object.entries(B).map(([k, v]) => [k, Object.fromEntries(['model', 'standin'].map((w) => [w, { n: v[w].n, exact_pct: pc(v[w].exact, v[w].n), field_pct: pc(v[w].fh, v[w].ft), valid_pct: pc(v[w].valid, v[w].n) }]))]));
out._avg_generate_ms = Math.round(ms / rows.length); out._model_bytes = man.bytes;
fs.writeFileSync(new URL('eval_js.json', M), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
