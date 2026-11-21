# SPDX-License-Identifier: Apache-2.0
"""tiny_model.py -- the ~6 MB encoder-decoder transformer for the world-spec task, written with plain matmuls so src/tinylm.js can reproduce it exactly.
Pre-LayerNorm blocks, learned position embeddings, GELU (tanh form), tied output embedding. Input = characters, output = closed-vocabulary tokens."""
import math

import torch
import torch.nn as nn
import torch.nn.functional as F

CFG = dict(d=256, heads=4, ff=768, enc_layers=4, dec_layers=3, max_in=112, max_out=32)


class Attn(nn.Module):
    def __init__(s, d, h):
        super().__init__(); s.h = h; s.q = nn.Linear(d, d); s.k = nn.Linear(d, d); s.v = nn.Linear(d, d); s.o = nn.Linear(d, d)

    def forward(s, x, mem, mask=None):
        B, T, D = x.shape; S = mem.shape[1]; h = s.h; dh = D // h
        q = s.q(x).view(B, T, h, dh).transpose(1, 2); k = s.k(mem).view(B, S, h, dh).transpose(1, 2); v = s.v(mem).view(B, S, h, dh).transpose(1, 2)
        a = (q @ k.transpose(-1, -2)) / math.sqrt(dh)
        if mask is not None:
            a = a.masked_fill(~mask, float("-inf"))
        return s.o((a.softmax(-1) @ v).transpose(1, 2).reshape(B, T, D))


class FFN(nn.Module):
    def __init__(s, d, ff):
        super().__init__(); s.a = nn.Linear(d, ff); s.b = nn.Linear(ff, d)

    def forward(s, x):
        return s.b(F.gelu(s.a(x), approximate="tanh"))


class EncLayer(nn.Module):
    def __init__(s, d, h, ff, p):
        super().__init__(); s.n1 = nn.LayerNorm(d); s.att = Attn(d, h); s.n2 = nn.LayerNorm(d); s.ff = FFN(d, ff); s.drop = nn.Dropout(p)

    def forward(s, x, mask):
        n = s.n1(x); x = x + s.drop(s.att(n, n, mask)); return x + s.drop(s.ff(s.n2(x)))


class DecLayer(nn.Module):
    def __init__(s, d, h, ff, p):
        super().__init__(); s.n1 = nn.LayerNorm(d); s.sa = Attn(d, h); s.n2 = nn.LayerNorm(d); s.ca = Attn(d, h); s.n3 = nn.LayerNorm(d); s.ff = FFN(d, ff); s.drop = nn.Dropout(p)

    def forward(s, x, mem, cmask, smask):
        n = s.n1(x); x = x + s.drop(s.sa(n, n, smask)); x = x + s.drop(s.ca(s.n2(x), mem, cmask)); return x + s.drop(s.ff(s.n3(x)))


class Tiny(nn.Module):
    def __init__(s, n_in, n_out, cfg=CFG, dropout=0.1):
        super().__init__(); d = cfg["d"]; s.cfg = cfg
        s.emb_in = nn.Embedding(n_in, d); s.pos_in = nn.Embedding(cfg["max_in"], d); s.emb_out = nn.Embedding(n_out, d); s.pos_out = nn.Embedding(cfg["max_out"], d)
        s.enc = nn.ModuleList([EncLayer(d, cfg["heads"], cfg["ff"], dropout) for _ in range(cfg["enc_layers"])]); s.enc_norm = nn.LayerNorm(d)
        s.dec = nn.ModuleList([DecLayer(d, cfg["heads"], cfg["ff"], dropout) for _ in range(cfg["dec_layers"])]); s.dec_norm = nn.LayerNorm(d)
        s.scale = math.sqrt(d)
        for e in (s.emb_in, s.emb_out):                       # tied output embedding: std 1/sqrt(d) keeps the first logits small (std 1 gave a loss of 37)
            nn.init.normal_(e.weight, std=d ** -0.5)
        for e in (s.pos_in, s.pos_out):
            nn.init.normal_(e.weight, std=0.3)

    def encode(s, src):                       # src: (B, S) char ids, 0 = pad
        B, S = src.shape; mask = (src != 0)[:, None, None, :]
        x = s.emb_in(src) * s.scale + s.pos_in(torch.arange(S, device=src.device))
        for l in s.enc:
            x = l(x, mask)
        return s.enc_norm(x), mask

    def decode(s, tgt, mem, cmask):           # tgt: (B, T) token ids
        B, T = tgt.shape; smask = torch.tril(torch.ones(T, T, dtype=torch.bool, device=tgt.device))[None, None]
        x = s.emb_out(tgt) * s.scale + s.pos_out(torch.arange(T, device=tgt.device))
        for l in s.dec:
            x = l(x, mem, cmask, smask)
        return s.dec_norm(x) @ s.emb_out.weight.T          # tied output embedding

    def forward(s, src, tgt):
        mem, cmask = s.encode(src); return s.decode(tgt, mem, cmask)

    @torch.no_grad()
    def greedy(s, src, bos, eos, max_len):
        mem, cmask = s.encode(src); B = src.shape[0]; out = torch.full((B, 1), bos, dtype=torch.long, device=src.device); done = torch.zeros(B, dtype=torch.bool, device=src.device)
        for _ in range(max_len - 1):
            nxt = s.decode(out, mem, cmask)[:, -1].argmax(-1); nxt = torch.where(done, torch.zeros_like(nxt), nxt)
            out = torch.cat([out, nxt[:, None]], 1); done |= nxt == eos
            if done.all():
                break
        return out
