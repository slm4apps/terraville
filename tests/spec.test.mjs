// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, resolveWorld, VOCAB, LIMITS } from '../src/spec.js';
import { parse } from '../src/parser.js';
import { makeNoise } from '../src/noise.js';
import { makeTerrain } from '../src/world.js';

test('validate: a good world spec passes and is cleaned', () => {
  const r = validate({ kind: 'world', biome: 'forest', terrain: 'hilly', water: 'lake', time: 'night', features: [{ name: 'village', count: 99 }], seed: 5, extra: 1 });
  assert.ok(r.ok, r.errors.join());
  assert.equal(r.spec.features[0].count, LIMITS.featureCount);        // clamped
  assert.equal(r.spec.extra, undefined);                              // unknown keys dropped
});
test('validate: unknown words are rejected, not repaired silently', () => {
  assert.equal(validate({ kind: 'world', biome: 'lava' }).ok, false);
  assert.equal(validate({ kind: 'world', features: [{ name: 'castle', count: 1 }] }).ok, false);
  assert.equal(validate({ kind: 'tool', tool: 'teleport' }).ok, false);
});
test('validate: junk and oversize input never throws', () => {
  for (const x of [null, 5, 'not json', '[1]', { kind: 'eval' }, 'x'.repeat(10000), { kind: 'world', game: { game: 'collect', count: 1e9 } }]) {
    const r = validate(x); assert.equal(typeof r.ok, 'boolean');
  }
  assert.equal(validate({ kind: 'world', game: { game: 'collect', count: 1e9 } }).spec.game.count, LIMITS.gameCount);
});
test('validate: code in a field is just an unknown word', () => {
  assert.equal(validate({ kind: 'world', biome: '<img src=x onerror=alert(1)>' }).ok, false);
  assert.equal(validate({ kind: 'say', text: '<script>alert(1)</script>' }).spec.text.length <= 200, true);
});
test('resolveWorld: every vocabulary biome resolves to numbers', () => {
  for (const b of VOCAB.biome) {
    const rw = resolveWorld(validate({ kind: 'world', biome: b }).spec);
    assert.ok(rw.amplitude > 0 && Number.isFinite(rw.frequency) && rw.perChunk.trees >= 0, b);
  }
});
test('noise is deterministic', () => {
  const a = makeNoise(3), b = makeNoise(3), c = makeNoise(4);
  assert.equal(a.fbm(12.3, 45.6), b.fbm(12.3, 45.6)); assert.notEqual(a.fbm(12.3, 45.6), c.fbm(12.3, 45.6));
});
test('terrain: finite heights, water exists for island / lake', () => {
  for (const [biome, water] of [['forest', 'lake'], ['island', 'sea'], ['desert', 'none'], ['mountains', 'river']]) {
    const t = makeTerrain(resolveWorld(validate({ kind: 'world', biome, water }).spec));
    for (let i = 0; i < 200; i++) assert.ok(Number.isFinite(t.height(i * 13.7, i * -9.1)));
  }
  assert.ok(makeTerrain(resolveWorld(validate({ kind: 'world', biome: 'island', water: 'sea' }).spec)).waterLevel > -1e8);
  assert.ok(makeTerrain(resolveWorld(validate({ kind: 'world', biome: 'desert', water: 'none' }).spec)).waterLevel < -1e8);
});
const CASES = [
  ['a snowy forest with a lake', { kind: 'world', biome: 'snow', water: 'lake' }],
  ['a desert with ruins at night', { kind: 'world', biome: 'desert', time: 'night' }],
  ['a village by the sea', { kind: 'world', water: 'sea' }],
  ['steep mountains with a river', { kind: 'world', biome: 'mountains', terrain: 'steep', water: 'river' }],
  ['a flat grassland with lots of flowers', { kind: 'world', biome: 'grassland', terrain: 'flat' }],
  ['an island with two villages and a tower', { kind: 'world', biome: 'island' }],
  ['make it denser', null], ['at night', null],
  ['build a bench', { kind: 'object', name: 'bench' }], ['make a red lamp', { kind: 'object', name: 'lamp' }], ['give me a hut', { kind: 'object', name: 'hut' }],
  ['collect 5 crystals in a cave world', { kind: 'world' }], ['dig a hole', { kind: 'tool', tool: 'dig' }], ['pick up the lamp', { kind: 'tool', tool: 'pickup' }],
  ['add a light', { kind: 'tool', tool: 'light' }],
];
test('parser: stand-in answers 15 phrases with valid specs', () => {
  for (const [text, want] of CASES) {
    const r = parse(text); assert.ok(r.spec, text);
    if (!want) continue;
    for (const [k, v] of Object.entries(want)) assert.equal(r.spec[k], v, `${text}: ${k}`);
    assert.ok(r.ok, text + ' ' + (r.errors || []).join());
  }
});
test('parser: features, counts and game', () => {
  const r = parse('a village with two towers and collect 7 crystals');
  assert.deepEqual(r.spec.features.map((f) => f.name).sort(), ['tower', 'village']);
  assert.equal(r.spec.features.find((f) => f.name === 'tower').count, 2);
  assert.deepEqual(r.spec.game, { game: 'collect', target: 'crystals', count: 7 });
});
test('parser: empty and garbage give a say, never a crash', () => {
  assert.equal(parse('').spec.kind, 'say'); assert.ok(parse('qwerty zzz').spec);
});
