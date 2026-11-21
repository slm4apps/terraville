# Training Terraville

Terraville is trained from scratch (no base model) on synthetic data. Everything below reproduces the shipped
`terraville-tiny.bin` from the files in this repository, with PyTorch (CUDA, MPS or CPU) and Node.js.

## 1. Data: `tools/gen_tiny.py`

```bash
python3 tools/gen_tiny.py        # writes data/tiny/{train,val,test}.jsonl, vocab.json, report.json
```

- Reads the item library (`models/library.json`) and the generator inputs in `data/` (`vocab.json`, `library/*.json`).
- Shipped model: 96,640 training rows (object 38,040, world 33,716, live change 9,000, tool 6,758, patch 4,519, chat 4,607),
  660 validation rows; input vocabulary 45 characters, output vocabulary 1,607 tokens.
- Test splits (never trained on): 437 seen phrasings, 300 held-out phrasings (whole sentence templates), 360 held-out
  synonyms; 1,097 rows in all. Three verbs (conjure, whip up, materialize) are held out of every training row.
- A share of item requests use a made-up verb, so the verb never names the item; refusals are not trained (an unknown item gets
  the nearest library item).
- Row counts for your run are in `data/tiny/report.json`. `data/tiny/train.jsonl` is not part of the repository: regenerate it.

## 2. Model and training: `tools/tiny_model.py`, `tools/train_tiny.py`

```bash
python3 tools/train_tiny.py --epochs 8
```

| | |
|---|---|
| model | encoder-decoder transformer, d=256, 4 heads, FF 768, 4 + 3 layers, pre-LayerNorm, GELU, learned positions, tied output embedding; 5.86 M parameters |
| optimiser | AdamW, lr 1.5e-3, betas (0.9, 0.98), weight decay 0.01, 150 warm-up steps then cosine to 3 % |
| batch / epochs | 256 / 8 (default is 6) |
| seed | 7 |
| gradient clipping | 1.0 |
| shipped run | 2,301 s on one Apple-silicon laptop (MPS); validation exact 92.9 % after epoch 8 |

The script quantises to int8 (per tensor), re-scores the quantised weights, and writes `models/terraville-tiny.bin` and
`models/terraville-tiny.json` (what the page loads) plus a fp32 `terraville-tiny.pt` (training copy, not shipped, 23 MB).

## 3. Checks: `tools/after_train.sh`

```bash
bash tools/after_train.sh
```

Writes `models/parity.json` from the quantised weights (PyTorch), runs `node tests/tinylm.parity.mjs` (the plain-JS engine
must give the same tokens), scores the JS engine on the test sets (`tools/eval_tiny_js.mjs`) and checks that JS and Python
decode to the same specs (gap <= 1.5 points; shipped: 0.1). Summary in `models/RESULTS.md`.

## 4. Benchmark: `tools/benchmark.mjs`

```bash
node tools/benchmark.mjs        # models/BENCHMARK.{md,json}: splits, kinds, verb probe, latency, download sizes
node tools/verb_probe.mjs       # held-out verbs vs seen verbs, 60 popular items x 3 verbs each
```

Latency depends on your CPU; the card quotes an Apple M3, one thread, 200 requests.

## Not included

The scripts that drafted the item-library designs are not part of this repository; the library ships as data.
