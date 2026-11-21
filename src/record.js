// SPDX-License-Identifier: Apache-2.0
// record.js -- records the game as a video: the WebGL view is copied into a 1280x720 canvas every frame, the HUD is drawn on top (the page's own HUD is DOM, so it would not be in a canvas
// capture), MediaRecorder encodes it, and at the end the file goes to the local record server (tools/record_server.mjs, 127.0.0.1:8078) or, if that is not there, is offered as a download.
export class Recorder {
  constructor(glCanvas, hudFn, audioStream) {
    this.gl = glCanvas; this.hud = hudFn; this.audio = audioStream || null;
    this.c = document.createElement('canvas'); this.c.width = 1280; this.c.height = 720; this.ctx = this.c.getContext('2d'); this.chunks = []; this.on = false;
  }
  start() {
    const stream = this.c.captureStream(30);
    if (this.audio) for (const t of this.audio.getAudioTracks()) stream.addTrack(t);
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000); this.on = true; this.t0 = performance.now(); this.mime = mimeType;
  }
  frame() {
    if (!this.on) return;
    const x = this.ctx, W = 1280, H = 720, gl = this.gl, s = Math.max(W / gl.width, H / gl.height), w = gl.width * s, h = gl.height * s;
    x.drawImage(gl, (W - w) / 2, (H - h) / 2, w, h);
    const d = this.hud(); if (!d) return;
    if (d.hurt > 0) { const g = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85); g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(255,0,0,${Math.min(0.55, d.hurt * 1.6)})`); x.fillStyle = g; x.fillRect(0, 0, W, H); }
    x.fillStyle = 'rgba(8,12,20,0.62)'; x.fillRect(16, 16, 470, 30 + d.lines.length * 26 + 22);
    x.fillStyle = '#2a2f3a'; x.fillRect(28, 28, 446, 16); x.fillStyle = d.health > 50 ? '#3ddc6a' : d.health > 25 ? '#f0c030' : '#ff4040'; x.fillRect(28, 28, 446 * Math.max(0, d.health) / 100, 16);
    x.font = '20px ui-monospace, Menlo, monospace'; x.fillStyle = '#fff'; d.lines.forEach((l, i) => x.fillText(l, 28, 74 + i * 26));
    x.font = '19px ui-monospace, Menlo, monospace'; d.log.slice(-5).forEach((m, i) => { x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(16, H - 28 - (d.log.slice(-5).length - i) * 28 + 2, 760, 26); x.fillStyle = '#ffe9a8'; x.fillText(m, 24, H - 28 - (d.log.slice(-5).length - i) * 28 + 22); });
    if (d.banner) { x.font = 'bold 54px system-ui, sans-serif'; x.fillStyle = 'rgba(255,60,60,0.95)'; x.textAlign = 'center'; x.fillText(d.banner, W / 2, H / 2); x.textAlign = 'left'; }
  }
  async stop(name) {
    if (!this.on) return null; this.on = false;
    const done = new Promise((res) => { this.rec.onstop = res; }); this.rec.stop(); await done;
    const blob = new Blob(this.chunks, { type: this.mime || 'video/webm' });
    try { const r = await fetch(`http://127.0.0.1:8078/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob }); return await r.json(); }
    catch (e) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.webm'; document.body.appendChild(a); a.click(); return { path: 'downloaded as ' + name + '.webm', bytes: blob.size }; }
  }
}
