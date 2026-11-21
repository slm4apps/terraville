// SPDX-License-Identifier: Apache-2.0
// dump_vocab.mjs -- one source of truth for the training data: prints VOCAB, TABLES words and the exact SYSTEM_PROMPT the page sends, plus the gold part lists.
import { VOCAB, SAY_MESSAGES } from '../src/spec.js';
import { SYSTEM_PROMPT } from '../src/model.js';
import { GOLD } from '../src/objects.js';
console.log(JSON.stringify({ vocab: VOCAB, system: SYSTEM_PROMPT, gold: GOLD, say_messages: SAY_MESSAGES }, null, 1));
