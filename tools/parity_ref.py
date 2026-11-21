#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""parity_ref.py -- reference numbers for the JS engine: greedy tokens and first-step logits of the QUANTIZED model (the exact weights the browser loads),
for 60 test sentences. tests/tinylm.parity.mjs must reproduce them."""
import json
import os
import sys

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.argv = [sys.argv[0], "--epochs", "0"]  # not training: only reuse the loaders below
import tiny_model as TM  # noqa: E402
import gen_tiny as GT  # noqa: E402

M = os.path.join(HERE, "..", "models")
man = json.load(open(os.path.join(M, "terraville-tiny.json"))); raw = open(os.path.join(M, "terraville-tiny.bin"), "rb").read()
CH, OUT = man["chars"], man["out"]; CID = {c: i for i, c in enumerate(CH)}; BOS, EOS = OUT.index("<bos>"), OUT.index("<eos>")
sd = {}
for t in man["tensors"]:
    shp = t["shape"]; n = int(np.prod(shp)); o = t["offset"]
    if t["dtype"] == "i8":
        q = np.frombuffer(raw, dtype=np.int8, count=n, offset=o).reshape(shp).astype(np.float32); s = np.frombuffer(raw, dtype="<f4", count=shp[0], offset=t["scale_offset"]); sd[t["name"]] = torch.tensor(q * s[:, None])
    elif t["dtype"] == "f16":
        sd[t["name"]] = torch.tensor(np.frombuffer(raw, dtype="<f2", count=n, offset=o).reshape(shp).astype(np.float32))
    else:
        sd[t["name"]] = torch.tensor(np.frombuffer(raw, dtype="<f4", count=n, offset=o).reshape(shp).copy())
m = TM.Tiny(len(CH), len(OUT)); m.load_state_dict(sd); m.eval()
rows = [json.loads(l) for l in open(os.path.join(GT.T, "test.jsonl"))][::13][:60]
ref = []
with torch.no_grad():
    for r in rows:
        ids = [CID.get(c, 1) for c in r["text"].lower()[:man["max_in"]]]; src = torch.tensor([ids])
        mem, cm = m.encode(src); first = m.decode(torch.tensor([[BOS]]), mem, cm)[0, -1].tolist()
        seq = m.greedy(src, BOS, EOS, man["max_out"])[0].tolist(); toks = []
        for x in seq[1:]:
            if x == EOS:
                break
            toks.append(OUT[x])
        ref.append({"text": r["text"], "tokens": toks, "first_logits": first})
json.dump(ref, open(os.path.join(M, "parity.json"), "w"))
print("wrote", len(ref), "parity rows")
