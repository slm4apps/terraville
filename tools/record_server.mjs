// SPDX-License-Identifier: Apache-2.0
// record_server.mjs -- receives the recorded video from the page and writes it to worldgen-poc/recordings/. Bound to 127.0.0.1 only.
//   node tools/record_server.mjs            (listens on 8078)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'recordings');
fs.mkdirSync(dir, { recursive: true });
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST' || !(req.url.startsWith('/upload') || req.url.startsWith('/session'))) { res.writeHead(404); return res.end(); }
  const ext = req.url.startsWith('/session') ? '.json' : '.webm';
  const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'recording').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60), out = path.join(dir, name + ext), ws = fs.createWriteStream(out);
  let n = 0; req.on('data', (c) => { n += c.length; }); req.pipe(ws);
  ws.on('finish', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: out, bytes: n })); console.log('saved', out, n); });
}).listen(8078, '127.0.0.1', () => console.log('record server on 127.0.0.1:8078 ->', dir));
