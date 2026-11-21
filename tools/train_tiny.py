#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""train_tiny.py -- trains the tiny world-spec transformer from scratch (CUDA / MPS / CPU), scores val + the three test splits (seen / held phrasing / held synonyms),
quantizes to int8 and RE-SCORES the quantized weights, then writes models/terraville-tiny.bin + models/terraville-tiny.json (what the browser loads).

    python3 tools/train_tiny.py [--epochs 6] [--out models]
"""
import argparse
import collections
import json
import os
import random
import struct
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_tiny as GT  # noqa: E402
from tiny_model import Tiny, CFG  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--epochs", type=int, default=6)
ap.add_argument("--bs", type=int, default=256)
ap.add_argument("--lr", type=float, default=1.5e-3)
ap.add_argument("--out", default=os.path.join(HERE, "..", "models"))
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
dev = "mps" if torch.backends.mps.is_available() else "cpu"
torch.manual_seed(7); random.seed(7)
V = json.load(open(os.path.join(GT.T, "vocab.json")))
CH, OUT = V["chars"], V["out"]; CID = {c: i for i, c in enumerate(CH)}; OID = {t: i for i, t in enumerate(OUT)}
PAD, BOS, EOS = 0, OID["<bos>"], OID["<eos>"]


def load(name):
    return [json.loads(l) for l in open(os.path.join(GT.T, name + ".jsonl"))]


def enc_text(t):
    ids = [CID.get(c, 1) for c in t.lower()[:V["max_in"]]]; return ids + [PAD] * (V["max_in"] - len(ids))


def enc_out(toks):
    ids = [BOS] + [OID[t] for t in toks] + [EOS]; return ids + [PAD] * (V["max_out"] - len(ids))


def tensors(rows):
    return torch.tensor([enc_text(r["text"]) for r in rows]), torch.tensor([enc_out(r["tokens"]) for r in rows])


train, val, test = load("train"), load("val"), load("test")
Xtr, Ytr = tensors(train); Xva, Yva = tensors(val)
model = Tiny(len(CH), len(OUT)).to(dev)
n_params = sum(p.numel() for p in model.parameters())
print(f"params {n_params/1e6:.2f} M  (fp32 {n_params*4/1e6:.1f} MB, int8 about {n_params/1e6:.1f} MB)  device {dev}", flush=True)
steps = args.epochs * (len(train) // args.bs)
opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01, betas=(0.9, 0.98))
sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 150) * (0.5 * (1 + np.cos(np.pi * min(1.0, s / steps)))) * 0.97 + 0.03)


def decode_batch(m, texts, bs=256):
    out = []
    for i in range(0, len(texts), bs):
        src = torch.tensor([enc_text(t) for t in texts[i:i + bs]]).to(dev)
        seq = m.greedy(src, BOS, EOS, V["max_out"]).cpu().tolist()
        for s in seq:
            toks = []
            for x in s[1:]:
                if x in (EOS, PAD):
                    break
                toks.append(OUT[x])
            out.append(toks)
    return out


def strip(s):
    s = json.loads(json.dumps(s)); s.pop("seed", None); return s


def evaluate(m, rows):
    m.eval(); preds = decode_batch(m, [r["text"] for r in rows]); b = collections.defaultdict(lambda: collections.Counter())
    for r, p in zip(rows, preds):
        spec = GT.decode_tokens(p); gold = strip(r["spec"]); keys = ("all", r.get("split", "val"), "kind:" + r["kind"])
        fields = [k for k in gold if k != "kind"]; hit = sum(1 for k in fields if spec and spec.get(k) == gold[k])
        for k in keys:
            b[k]["n"] += 1; b[k]["tok_exact"] += p == r["tokens"]; b[k]["spec_exact"] += (spec == gold); b[k]["valid"] += spec is not None; b[k]["kind"] += bool(spec and spec["kind"] == gold["kind"]); b[k]["fh"] += hit; b[k]["ft"] += len(fields)
    return {k: {"n": v["n"], "valid_pct": round(100 * v["valid"] / v["n"], 1), "kind_pct": round(100 * v["kind"] / v["n"], 1), "token_exact_pct": round(100 * v["tok_exact"] / v["n"], 1),
                "spec_exact_pct": round(100 * v["spec_exact"] / v["n"], 1), "field_pct": round(100 * v["fh"] / max(1, v["ft"]), 1)} for k, v in b.items()}


t0 = time.time(); step = 0
for ep in range(args.epochs):
    model.train(); perm = torch.randperm(len(train)); tot = 0.0; nb = 0
    for i in range(0, len(train) - args.bs + 1, args.bs):
        ix = perm[i:i + args.bs]; x = Xtr[ix].to(dev); y = Ytr[ix].to(dev)
        logits = model(x, y[:, :-1]); loss = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), y[:, 1:].reshape(-1), ignore_index=PAD)
        opt.zero_grad(set_to_none=True); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step(); step += 1; tot += loss.item(); nb += 1
    v = evaluate(model, val)["val"]
    print(f"epoch {ep+1}/{args.epochs} loss {tot/nb:.4f} val spec_exact {v['spec_exact_pct']} field {v['field_pct']} valid {v['valid_pct']} ({time.time()-t0:.0f}s)", flush=True)

fp32 = evaluate(model, test)
torch.save(model.state_dict(), os.path.join(args.out, "terraville-tiny.pt"))


# ---- export: int8 per-row for the big matrices, fp16 for embeddings / positions, fp32 for biases and norms ----
def export(m, path_bin, path_json):
    sd = {k: v.detach().cpu().float().numpy() for k, v in m.state_dict().items()}
    man, blob = [], bytearray()
    for name, w in sd.items():
        if w.ndim == 2 and "emb" not in name and "pos" not in name:
            s = np.maximum(np.abs(w).max(1), 1e-8) / 127.0; q = np.clip(np.round(w / s[:, None]), -127, 127).astype(np.int8)
            man.append({"name": name, "dtype": "i8", "shape": list(w.shape), "offset": len(blob), "scale_offset": len(blob) + q.nbytes}); blob += q.tobytes(); blob += s.astype("<f4").tobytes()
        elif w.ndim == 2:
            h = w.astype("<f2"); man.append({"name": name, "dtype": "f16", "shape": list(w.shape), "offset": len(blob)}); blob += h.tobytes()
        else:
            f = w.astype("<f4"); man.append({"name": name, "dtype": "f32", "shape": list(w.shape), "offset": len(blob)}); blob += f.tobytes()
        while len(blob) % 4:
            blob += b"\0"
    open(path_bin, "wb").write(bytes(blob))
    json.dump({"cfg": CFG, "chars": CH, "out": OUT, "max_in": V["max_in"], "max_out": V["max_out"], "say": V["say"], "tensors": man, "bytes": len(blob)}, open(path_json, "w"))
    return len(blob)


def load_quantized(path_bin, path_json):
    man = json.load(open(path_json)); raw = open(path_bin, "rb").read(); sd = {}
    for t in man["tensors"]:
        shp = t["shape"]; n = int(np.prod(shp)); o = t["offset"]
        if t["dtype"] == "i8":
            q = np.frombuffer(raw, dtype=np.int8, count=n, offset=o).reshape(shp).astype(np.float32); s = np.frombuffer(raw, dtype="<f4", count=shp[0], offset=t["scale_offset"]); sd[t["name"]] = torch.tensor(q * s[:, None])
        elif t["dtype"] == "f16":
            sd[t["name"]] = torch.tensor(np.frombuffer(raw, dtype="<f2", count=n, offset=o).reshape(shp).astype(np.float32))
        else:
            sd[t["name"]] = torch.tensor(np.frombuffer(raw, dtype="<f4", count=n, offset=o).reshape(shp).copy())
    m = Tiny(len(CH), len(OUT)).to(dev); m.load_state_dict(sd); return m


nbytes = export(model, os.path.join(args.out, "terraville-tiny.bin"), os.path.join(args.out, "terraville-tiny.json"))
q = evaluate(load_quantized(os.path.join(args.out, "terraville-tiny.bin"), os.path.join(args.out, "terraville-tiny.json")), test)
res = {"params": n_params, "model_bytes": nbytes, "model_mb": round(nbytes / 1e6, 2), "fp32": fp32, "int8": q, "train_seconds": round(time.time() - t0)}
json.dump(res, open(os.path.join(args.out, "eval.json"), "w"), indent=1)
print(json.dumps({"model_mb": res["model_mb"], "params_m": round(n_params / 1e6, 2), "fp32_all": fp32["all"], "int8_all": q["all"],
                  "int8_by_split": {k: v["spec_exact_pct"] for k, v in q.items() if k.startswith("test")}}, indent=1), flush=True)
