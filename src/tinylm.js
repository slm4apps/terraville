// SPDX-License-Identifier: Apache-2.0
// tinylm.js -- the model that lives IN THE PAGE: a ~6 MB encoder-decoder transformer, int8 weights, run in plain JavaScript (no WASM, no libraries, no server).
// It mirrors tools/tiny_model.py exactly (pre-LN blocks, tanh GELU, tied output embedding) and is checked against the PyTorch logits by tests/tinylm.parity.mjs.
// Input: the request as characters. Output: a short run of closed-vocabulary tokens, turned into a spec by decodeTokens() (same rules as tools/gen_tiny.py).
import { GOLD } from './objects.js';

const gelu = (x) => 0.5 * x * (1 + Math.tanh(0.7978845608028654 * (x + 0.044715 * x * x * x)));

export function decodeTokens(tokens, say, libNames) {
  const toks = tokens.filter((t) => !['<pad>', '<bos>', '<eos>'].includes(t));
  if (!toks.length || !toks[0].startsWith('K:')) return null;
  const kind = toks[0].slice(2), s = { kind };
  let i = 1;
  if (kind === 'world' || kind === 'patch') {
    const names = { B: 'biome', T: 'terrain', W: 'water', D: 'time' };
    while (i < toks.length) {
      const x = toks[i], a = x[0], b = x.slice(2);
      if (a === 'Y') s.style = b;
      else if (names[a]) s[names[a]] = b;
      else if (a === 'P') { const [p, l] = b.split('='); (s.density ||= {})[p] = l; }
      else if (a === 'F') { let n = 1; if (toks[i + 1] && toks[i + 1].startsWith('N:')) { n = +toks[i + 1].slice(2); i++; } (s.features ||= []).push({ name: b, count: n }); }
      else if (a === 'G') {
        const g = { game: b };
        if (b === 'collect' && toks[i + 1] && toks[i + 1].startsWith('X:')) { g.target = toks[++i].slice(2); if (toks[i + 1] && toks[i + 1].startsWith('N:')) g.count = +toks[++i].slice(2); }
        s.game = g;
      } else return null;
      i++;
    }
  } else if (kind === 'object') {
    if (toks[i] && toks[i].startsWith('Y:')) s.style = toks[i++].slice(2);
    if (!toks[i] || !toks[i].startsWith('O:')) return null;
    s.name = toks[i++].slice(2);
    for (; i < toks.length; i++) { if (toks[i].startsWith('Y:')) s.style = toks[i].slice(2); else if (toks[i].startsWith('C:')) s.color = toks[i].slice(2); else if (toks[i].startsWith('N:')) s.count = +toks[i].slice(2); }
  } else if (kind === 'tool') {
    if (!toks[1] || !toks[1].startsWith('L:') || !toks[2] || !toks[2].startsWith('S:')) return null;
    s.tool = toks[1].slice(2); s.size = toks[2].slice(2);
  } else if (kind === 'adjust') {
    if (!toks[1] || !toks[1].startsWith('A:')) return null;
    s.aspect = toks[1].slice(2); s.dir = toks[2] && toks[2].startsWith('E:') ? toks[2].slice(2) : 'up';
  } else if (kind === 'say') {
    if (!toks[1] || !toks[1].startsWith('M:') || say[+toks[1].slice(2)] === undefined) return null;
    s.text = say[+toks[1].slice(2)];
  } else return null;
  return s;
}

export class TinyLM {
  static async load(baseUrl, onProgress) {
    const man = await (await fetch(baseUrl + '.json')).json();
    const resp = await fetch(baseUrl + '.bin'), total = +resp.headers.get('content-length') || man.bytes;
    let buf;
    if (resp.body && onProgress) {                              // stream so the page can show a progress bar
      const reader = resp.body.getReader(), chunks = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(got / total); }
      buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
      buf = buf.buffer;
    } else buf = await resp.arrayBuffer();
    return new TinyLM(man, buf);
  }

  constructor(man, buf) {
    this.man = man; this.cfg = man.cfg; this.w = {};
    const dv = new DataView(buf);
    for (const t of man.tensors) {
      const n = t.shape.reduce((a, b) => a * b, 1), out = new Float32Array(n);
      if (t.dtype === 'i8') {
        const q = new Int8Array(buf, t.offset, n), rows = t.shape[0], cols = n / rows;
        for (let r = 0; r < rows; r++) { const s = dv.getFloat32(t.scale_offset + r * 4, true); for (let c = 0; c < cols; c++) out[r * cols + c] = q[r * cols + c] * s; }
      } else if (t.dtype === 'f16') for (let i = 0; i < n; i++) out[i] = f16(dv.getUint16(t.offset + i * 2, true));
      else for (let i = 0; i < n; i++) out[i] = dv.getFloat32(t.offset + i * 4, true);
      this.w[t.name] = { data: out, shape: t.shape };
    }
    this.cid = new Map(man.chars.map((c, i) => [c, i])); this.oid = new Map(man.out.map((t, i) => [t, i]));
    this.bos = this.oid.get('<bos>'); this.eos = this.oid.get('<eos>');
  }

  // ---- tensor helpers (row-major Float32Array) ----
  lin(x, T, name) {            // y = x W^T + b ; x: T x in, W: out x in
    const W = this.w[name + '.weight'], b = this.w[name + '.bias'], [O, I] = W.shape, y = new Float32Array(T * O), wd = W.data, bd = b ? b.data : null;
    for (let t = 0; t < T; t++) { const xo = t * I; for (let o = 0; o < O; o++) { let s = bd ? bd[o] : 0; const wo = o * I; for (let i = 0; i < I; i++) s += x[xo + i] * wd[wo + i]; y[t * O + o] = s; } }
    return y;
  }
  ln(x, T, name) {
    const g = this.w[name + '.weight'].data, b = this.w[name + '.bias'].data, D = g.length, y = new Float32Array(T * D);
    for (let t = 0; t < T; t++) {
      let m = 0; for (let i = 0; i < D; i++) m += x[t * D + i]; m /= D;
      let v = 0; for (let i = 0; i < D; i++) { const d = x[t * D + i] - m; v += d * d; } v /= D; const r = 1 / Math.sqrt(v + 1e-5);
      for (let i = 0; i < D; i++) y[t * D + i] = (x[t * D + i] - m) * r * g[i] + b[i];
    }
    return y;
  }
  attn(prefix, xq, Tq, xkv, Tk, kvMask, causal) {                // multi-head attention; kvMask: Uint8Array(Tk) 1 = visible
    const D = this.cfg.d, h = this.cfg.heads, dh = D / h, q = this.lin(xq, Tq, prefix + '.q'), k = this.lin(xkv, Tk, prefix + '.k'), v = this.lin(xkv, Tk, prefix + '.v'), out = new Float32Array(Tq * D), sc = new Float32Array(Tk), rs = 1 / Math.sqrt(dh);
    for (let hd = 0; hd < h; hd++) for (let i = 0; i < Tq; i++) {
      let mx = -Infinity;
      for (let j = 0; j < Tk; j++) {
        if ((kvMask && !kvMask[j]) || (causal && j > i)) { sc[j] = -Infinity; continue; }
        let s = 0; for (let d = 0; d < dh; d++) s += q[i * D + hd * dh + d] * k[j * D + hd * dh + d]; s *= rs; sc[j] = s; if (s > mx) mx = s;
      }
      let z = 0; for (let j = 0; j < Tk; j++) { const e = sc[j] === -Infinity ? 0 : Math.exp(sc[j] - mx); sc[j] = e; z += e; }
      for (let j = 0; j < Tk; j++) { const a = sc[j] / z; if (a === 0) continue; for (let d = 0; d < dh; d++) out[i * D + hd * dh + d] += a * v[j * D + hd * dh + d]; }
    }
    return this.lin(out, Tq, prefix + '.o');
  }
  ffn(x, T, prefix) { const a = this.lin(x, T, prefix + '.a'); for (let i = 0; i < a.length; i++) a[i] = gelu(a[i]); return this.lin(a, T, prefix + '.b'); }
  add(a, b) { for (let i = 0; i < a.length; i++) a[i] += b[i]; return a; }

  encode(text) {
    const D = this.cfg.d, max = this.man.max_in, ids = [...text.toLowerCase().slice(0, max)].map((c) => this.cid.get(c) ?? 1), S = ids.length, mask = new Uint8Array(S).fill(1);
    const E = this.w['emb_in.weight'].data, P = this.w['pos_in.weight'].data, sc = Math.sqrt(D); let x = new Float32Array(S * D);
    for (let t = 0; t < S; t++) for (let d = 0; d < D; d++) x[t * D + d] = E[ids[t] * D + d] * sc + P[t * D + d];
    for (let l = 0; l < this.cfg.enc_layers; l++) {
      const n1 = this.ln(x, S, `enc.${l}.n1`); x = this.add(x, this.attn(`enc.${l}.att`, n1, S, n1, S, mask, false));
      x = this.add(x, this.ffn(this.ln(x, S, `enc.${l}.n2`), S, `enc.${l}.ff`));
    }
    return { mem: this.ln(x, S, 'enc_norm'), S, mask };
  }

  /** logits for the last position of the token prefix (recomputes the prefix: it is at most ~20 tokens) */
  stepLogits(enc, prefix) {
    const D = this.cfg.d, T = prefix.length, E = this.w['emb_out.weight'].data, P = this.w['pos_out.weight'].data, sc = Math.sqrt(D); let x = new Float32Array(T * D);
    for (let t = 0; t < T; t++) for (let d = 0; d < D; d++) x[t * D + d] = E[prefix[t] * D + d] * sc + P[t * D + d];
    for (let l = 0; l < this.cfg.dec_layers; l++) {
      const n1 = this.ln(x, T, `dec.${l}.n1`); x = this.add(x, this.attn(`dec.${l}.sa`, n1, T, n1, T, null, true));
      x = this.add(x, this.attn(`dec.${l}.ca`, this.ln(x, T, `dec.${l}.n2`), T, enc.mem, enc.S, enc.mask, false));
      x = this.add(x, this.ffn(this.ln(x, T, `dec.${l}.n3`), T, `dec.${l}.ff`));
    }
    const last = this.ln(x, T, 'dec_norm').subarray((T - 1) * D, T * D), V = this.man.out.length, logits = new Float32Array(V);
    for (let v = 0; v < V; v++) { let s = 0; for (let d = 0; d < D; d++) s += last[d] * E[v * D + d]; logits[v] = s; }
    return logits;
  }

  /** greedy decode -> { tokens, spec, ms } */
  generate(text) {
    const t0 = performance.now(), enc = this.encode(text), seq = [this.bos], out = [];
    for (let i = 0; i < this.man.max_out - 2; i++) {
      const l = this.stepLogits(enc, seq); let best = 0; for (let v = 1; v < l.length; v++) if (l[v] > l[best]) best = v;
      if (best === this.eos) break; seq.push(best); out.push(this.man.out[best]);
    }
    return { tokens: out, spec: decodeTokens(out, this.man.say, this.libNames), ms: performance.now() - t0 };
  }
}

function f16(h) {                                          // IEEE half -> float
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
