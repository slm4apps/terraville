// SPDX-License-Identifier: Apache-2.0
// parity: the plain-JS engine must reproduce the PyTorch greedy tokens and first-step logits of the same quantized weights.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TinyLM } from '../src/tinylm.js';

const M = new URL('../models/', import.meta.url);
const man = JSON.parse(fs.readFileSync(new URL('terraville-tiny.json', M), 'utf8')), buf = fs.readFileSync(new URL('terraville-tiny.bin', M));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const lm = new TinyLM(man, ab), ref = JSON.parse(fs.readFileSync(new URL('parity.json', M), 'utf8'));

test('first-step logits match PyTorch (max abs diff < 1e-3)', () => {
  let worst = 0;
  for (const r of ref.slice(0, 12)) {
    const l = lm.stepLogits(lm.encode(r.text), [lm.bos]);
    for (let i = 0; i < l.length; i++) worst = Math.max(worst, Math.abs(l[i] - r.first_logits[i]));
  }
  console.log('max abs logit diff', worst.toExponential(2)); assert.ok(worst < 1e-3, 'diff ' + worst);
});
test('greedy tokens match PyTorch on 60 sentences', () => {
  let bad = 0, ms = 0;
  for (const r of ref) { const g = lm.generate(r.text); ms += g.ms; if (JSON.stringify(g.tokens) !== JSON.stringify(r.tokens)) { bad++; console.log('DIFF', r.text, g.tokens.join(' '), '|', r.tokens.join(' ')); } }
  console.log('avg generate ms', (ms / ref.length).toFixed(0)); assert.equal(bad, 0);
});
test('model file is within the 10-20 MB budget', () => { assert.ok(man.bytes < 10e6, 'bytes ' + man.bytes); });
