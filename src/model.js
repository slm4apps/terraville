// SPDX-License-Identifier: Apache-2.0
// model.js -- the hook for the small trained model. It talks to a LOCAL llama.cpp server (OpenAI-compatible, bound to 127.0.0.1) and gets back ONE json
// object; that object is validated exactly like user input before the engine sees it. No answer is ever evaluated as code. If the server is not there,
// or its answer does not validate, the caller falls back to the stand-in parser and says so.
import { VOCAB, validate } from './spec.js';

export const SYSTEM_PROMPT =
  'You turn a request into ONE json object for a small world engine. Reply with json only. Kinds: world, patch, object, tool, say. ' +
  'world/patch fields: biome (' + VOCAB.biome.join(', ') + '), terrain (' + VOCAB.terrain.join(', ') + '), water (' + VOCAB.water.join(', ') + '), time (' + VOCAB.time.join(', ') + '), ' +
  'density {trees, rocks, grass, flowers, crystals: ' + VOCAB.density.join(', ') + '}, features [{name: ' + VOCAB.feature.join(', ') + ', count: 1-8}], ' +
  'game {game: ' + VOCAB.game.join(', ') + ', target: ' + VOCAB.target.join(', ') + ', count: 1-30}. patch has only the fields that change. ' +
  'object: {name: ' + VOCAB.object.join(', ') + ', parts: [{shape: ' + VOCAB.shape.join(', ') + ', size: [x, y, z words: ' + VOCAB.sizeWord.join(', ') + '], color, place: {relation: ' + VOCAB.place.join(', ') + ', on: part index}}]}. ' +
  'tool: {tool: ' + VOCAB.tool.join(', ') + ', size: ' + VOCAB.toolSize.join(', ') + '}. say: {text}. Use only these words. Never write code.';

export const DEFAULT_URL = 'http://127.0.0.1:8099/v1/chat/completions';

export async function askModel(text, url = DEFAULT_URL, timeoutMs = 20000) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ temperature: 0, max_tokens: 400, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }] }),
    });
    if (!r.ok) return { via: 'model', ok: false, errors: ['http ' + r.status], spec: null };
    const j = await r.json(); const reply = j.choices?.[0]?.message?.content ?? '';
    return { via: 'model', raw: reply, ...validate(reply) };
  } catch (e) {
    return { via: 'model', ok: false, errors: [String(e.name || e)], spec: null };
  } finally { clearTimeout(timer); }
}
