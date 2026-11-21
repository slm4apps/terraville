// SPDX-License-Identifier: Apache-2.0
// benchmark.mjs -- Terraville's published numbers, reproducible with one command (plain JS, the same code the page runs):
//   node tools/benchmark.mjs            -> models/BENCHMARK.json + models/BENCHMARK.md
// Runs: the test splits (tools/eval_tiny_js.mjs: seen phrasing / held-out phrasing / held-out synonyms, by kind, vs the keyword stand-in),
// the held-out-verb probe (tools/verb_probe.mjs), latency percentiles, and download sizes (raw + gzip) of what the page fetches.
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { TinyLM } from '../src/tinylm.js';

const R = (p) => new URL('../' + p, import.meta.url), M = R('models/');
const run = (script, args = []) => execFileSync(process.execPath, [new URL(script, import.meta.url).pathname, ...args], { stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 26 });
console.error('test splits ...'); run('eval_tiny_js.mjs');
console.error('verb probe ...'); run('verb_probe.mjs', ['--items', '60']);
const ev = JSON.parse(fs.readFileSync(new URL('eval_js.json', M))), vp = JSON.parse(fs.readFileSync(new URL('verb_probe.json', M)));

// latency: 200 test sentences, one at a time, after 10 warm-up calls
const man = JSON.parse(fs.readFileSync(new URL('terraville-tiny.json', M))), buf = fs.readFileSync(new URL('terraville-tiny.bin', M));
const t0 = performance.now(), lm = new TinyLM(man, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), loadMs = performance.now() - t0;
const texts = fs.readFileSync(R('data/tiny/test.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).text);
for (const t of texts.slice(0, 10)) lm.generate(t);
const ms = texts.slice(10, 210).map((t) => lm.generate(t).ms).sort((a, b) => a - b), q = (p) => +ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(0);

const size = (p) => { const b = fs.readFileSync(R(p)); return { file: p, bytes: b.length, gzip_bytes: zlib.gzipSync(b, { level: 9 }).length }; };
const files = ['models/terraville-tiny.bin', 'models/terraville-tiny.json', 'models/library.json', 'src/tinylm.js', 'src/spec.js'].map(size);
const lib = JSON.parse(fs.readFileSync(R('models/library.json')));
const out = {
  date: new Date().toISOString(), machine: `${os.cpus()[0].model}, ${os.cpus().length} cores, node ${process.version}`,
  model: { bytes: man.bytes, cfg: man.cfg, out_vocab: man.out.length, in_chars: man.chars.length },
  splits: ev, verb_probe: { items: vp.items, held_pct: vp.held_pct, seen_pct: vp.seen_pct, by_verb: vp.by_verb },
  latency_ms: { load: +loadMs.toFixed(0), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1), n: ms.length },
  download: { files, total_gzip_bytes: files.reduce((a, f) => a + f.gzip_bytes, 0) }, library: { names: lib.names.length, designs: Object.values(lib.recipes).reduce((a, r) => a + r.length, 0) },
};
fs.writeFileSync(new URL('BENCHMARK.json', M), JSON.stringify(out, null, 1));

const m = (k) => ev[k]?.model || {}, s = (k) => ev[k]?.standin || {}, kb = (b) => (b / 1024).toFixed(0) + ' KB', mb = (b) => (b / 1048576).toFixed(2) + ' MB';
const L = [`# Terraville benchmark`, '', `Run ${out.date.slice(0, 16)}Z on ${out.machine}. Reproduce: \`node tools/benchmark.mjs\`.`, '',
  '## Understanding (exact = the whole spec right; field = share of fields right)', '',
  '| test split | n | Terraville exact % | field % | valid % | keyword stand-in exact % | field % |', '|---|---:|---:|---:|---:|---:|---:|',
  ...['all', 'test_seen', 'test_held_phrasing', 'test_held_synonyms'].map((k) => `| ${k.replace('test_', '')} | ${m(k).n} | ${m(k).exact_pct} | ${m(k).field_pct} | ${m(k).valid_pct} | ${s(k).exact_pct} | ${s(k).field_pct} |`),
  '', '| kind | n | exact % | field % |', '|---|---:|---:|---:|',
  ...Object.keys(ev).filter((k) => k.startsWith('kind:')).map((k) => `| ${k.slice(5)} | ${m(k).n} | ${m(k).exact_pct} | ${m(k).field_pct} |`),
  '', `## Verb invariance (${vp.items} popular items, exact item name)`, '', '| verb | in training? | hit |', '|---|---|---|',
  ...Object.entries(vp.by_verb).map(([v, h]) => `| ${v} | ${['conjure', 'whip up', 'materialize'].includes(v) ? 'no (held out)' : 'yes'} | ${h} |`),
  '', `Held-out verbs ${vp.held_pct} %, seen verbs ${vp.seen_pct} %.`, '',
  '## Speed (plain JavaScript, one CPU thread, no GPU, no WASM)', '', `Model load ${out.latency_ms.load} ms. Per request: p50 ${out.latency_ms.p50} ms, p90 ${out.latency_ms.p90} ms, p99 ${out.latency_ms.p99} ms (n=${ms.length}).`, '',
  '## Download', '', '| file | raw | gzip |', '|---|---:|---:|', ...files.map((f) => `| ${f.file} | ${f.bytes > 1048576 ? mb(f.bytes) : kb(f.bytes)} | ${f.gzip_bytes > 1048576 ? mb(f.gzip_bytes) : kb(f.gzip_bytes)} |`),
  '', `Total (gzip): ${mb(out.download.total_gzip_bytes)}. Item library: ${out.library.names} names, ${out.library.designs} designs.`, ''];
fs.writeFileSync(new URL('BENCHMARK.md', M), L.join('\n'));
console.log(L.join('\n'));
