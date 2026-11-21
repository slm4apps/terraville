# Terraville benchmark

Run 2026-11-17T12:51Z on Apple M3, 8 cores, node v26.12.0. Reproduce: `node tools/benchmark.mjs`.

## Understanding (exact = the whole spec right; field = share of fields right)

| test split | n | Terraville exact % | field % | valid % | keyword stand-in exact % | field % |
|---|---:|---:|---:|---:|---:|---:|
| all | 1097 | 70.3 | 88.6 | 99.7 | 38 | 77.4 |
| seen | 437 | 94.5 | 97.9 | 100 | 24.7 | 63.8 |
| held_phrasing | 300 | 91 | 97.8 | 100 | 56 | 88.9 |
| held_synonyms | 360 | 23.6 | 70.9 | 99.2 | 39.2 | 77.3 |

| kind | n | exact % | field % |
|---|---:|---:|---:|
| say | 9 | 100 | 100 |
| world | 669 | 68 | 89.9 |
| object | 248 | 73 | 83.1 |
| patch | 63 | 85.7 | 87.8 |
| tool | 11 | 100 | 100 |
| adjust | 97 | 62.9 | 75.3 |

## Verb invariance (60 popular items, exact item name)

| verb | in training? | hit |
|---|---|---|
| conjure | no (held out) | 48/60 (80.0 %) |
| whip up | no (held out) | 59/60 (98.3 %) |
| materialize | no (held out) | 53/60 (88.3 %) |
| make | yes | 59/60 (98.3 %) |
| add | yes | 58/60 (96.7 %) |
| spawn | yes | 59/60 (98.3 %) |

Held-out verbs 88.9 %, seen verbs 97.8 %.

## Speed (plain JavaScript, one CPU thread, no GPU, no WASM)

Model load 20 ms. Per request: p50 191 ms, p90 739 ms, p99 1326 ms (n=200).

## Download

| file | raw | gzip |
|---|---:|---:|
| models/terraville-tiny.bin | 6.17 MB | 5.81 MB |
| models/terraville-tiny.json | 41 KB | 11 KB |
| models/library.json | 1.09 MB | 265 KB |
| src/tinylm.js | 9 KB | 3 KB |
| src/spec.js | 11 KB | 4 KB |

Total (gzip): 6.08 MB. Item library: 1461 names, 2141 designs.
