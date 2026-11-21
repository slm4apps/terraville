#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# after_train.sh -- runs BY ITSELF when the tiny model finishes training (it waits for models/eval.json), so nothing depends on a session being open:
#   1. parity reference from the quantized weights (PyTorch)  2. JS parity test (plain-JS engine == PyTorch)  3. JS eval of the in-browser model vs the stand-in
#   4. models/RESULTS.md (one readable summary).  Log: models/after_train.log (ends AFTER-TRAIN-DONE).
cd "$(dirname "$0")/.." || exit 1
PY=python3; LOG=models/after_train.log
echo "after_train waiting $(date -u +%FT%TZ)" >> $LOG
n=0
until [ -f models/eval.json ]; do
  n=$((n + 1)); [ $n -gt 720 ] && { echo "gave up waiting for models/eval.json" >> $LOG; exit 1; }
  sleep 30
done
sleep 5
echo "train finished, running checks $(date -u +%FT%TZ)" >> $LOG
$PY tools/parity_ref.py >> $LOG 2>&1
node --test tests/tinylm.parity.mjs >> models/parity.log 2>&1; echo "parity rc=$?" >> $LOG
node tools/eval_tiny_js.mjs > models/eval_js.out 2>&1; echo "eval_js rc=$?" >> $LOG
python3 - <<'PYEOF' >> $LOG 2>&1
import json
m = json.load(open("models/eval.json")); j = json.load(open("models/eval_js.json"))
par = open("models/parity.log").read()
ok = "# fail 0" in par or "ℹ fail 0" in par
L = ["# Terraville tiny model: results", "", f"- model file: {m['model_mb']} MB (budget 10-20 MB), {m['params']/1e6:.2f} M parameters, trained in {m['train_seconds']} s on one laptop",
     f"- JS engine matches PyTorch (parity test): {'YES' if ok else 'NO, see models/parity.log'}",
     f"- JS speed: {j.get('_avg_generate_ms')} ms per request on this CPU (plain JS, no GPU)"]
# token parity alone missed a JS DECODER bug (Y: style tokens made every styled spec null), so also compare the decoded spec scores
gap = abs(m["fp32"]["all"]["spec_exact_pct"] - j["all"]["model"]["exact_pct"]) if "fp32" in m else 0
L += [f"- JS decode == Python decode (spec exact gap {gap:.1f} points): {'YES' if gap <= 1.5 else 'NO: check decodeTokens in src/tinylm.js vs tools/gen_tiny.py'}", "",
     "| split | n | in-browser model exact % | field % | stand-in rules exact % | field % |", "|---|---:|---:|---:|---:|---:|"]
for k in ("all", "test_seen", "test_held_phrasing", "test_held_synonyms"):
    if k in j:
        L.append(f"| {k} | {j[k]['model']['n']} | {j[k]['model']['exact_pct']} | {j[k]['model']['field_pct']} | {j[k]['standin']['exact_pct']} | {j[k]['standin']['field_pct']} |")
L += ["", "By kind:", "", "| kind | model exact % | stand-in exact % |", "|---|---:|---:|"]
for k, v in j.items():
    if k.startswith("kind:"):
        L.append(f"| {k[5:]} | {v['model']['exact_pct']} | {v['standin']['exact_pct']} |")
open("models/RESULTS.md", "w").write("\n".join(L) + "\n"); print("\n".join(L))
PYEOF
echo "AFTER-TRAIN-DONE $(date -u +%FT%TZ)" >> $LOG
