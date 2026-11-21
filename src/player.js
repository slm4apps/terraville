// SPDX-License-Identifier: Apache-2.0
// player.js -- explore controls (CODE): pointer-lock mouse look, WASD, shift to run, space to jump, gravity, follows the analytic height field, wades in water.
export class Player {
  constructor(camera, dom, world) {
    this.camera = camera; this.dom = dom; this.world = world;
    this.pos = { x: 0, y: 0, z: 0 }; this.vy = 0; this.yaw = 0; this.pitch = 0; this.keys = new Set(); this.onGround = true; this.locked = false;
    this.setWorld(world);
    addEventListener('keydown', (e) => { if (!this.typing()) this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('click', () => { if (!this.typing()) dom.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
  }
  typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
  setWorld(world) { this.world = world; const s = world.findSpawn(this.pos.x, this.pos.z); world.spawn = s; this.pos.x = s.x; this.pos.z = s.z; this.yaw = s.yaw; this.pitch = -0.05; this.pos.y = world.height(s.x, s.z) + 1.7; this.vy = 0; }
  update(dt) {
    dt = Math.min(dt, 0.05);
    const k = this.keys, fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const gAt = (x, z) => Math.max(this.world.height(x, z), this.solids ? this.solids.groundAt(x, z, this.pos.y - 1.7) : -Infinity);
    const ground = gAt(this.pos.x, this.pos.z), wl = this.world.terrain.waterLevel;
    const wading = ground < wl - 0.3;
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 14 : 6) * (wading ? 0.5 : 1);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = (-sin * fwd + cos * str), mz = (-cos * fwd - sin * str); const l = Math.hypot(mx, mz) || 1;
    if (fwd || str) { this.pos.x += (mx / l) * speed * dt; this.pos.z += (mz / l) * speed * dt; }
    if (this.solids) this.solids.resolve(this.pos, 0.35, this.pos.y - 1.7);
    const g2 = gAt(this.pos.x, this.pos.z), eye = Math.max(g2, wading ? wl - 0.3 : g2) + 1.7;
    if (k.has('Space') && this.onGround) { this.vy = 6.5; this.onGround = false; }
    this.vy -= 18 * dt; this.pos.y += this.vy * dt;
    if (this.pos.y <= eye) { this.pos.y = eye; this.vy = 0; this.onGround = true; }
    this.camera.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
  forwardPoint(dist) { return { x: this.pos.x - Math.sin(this.yaw) * dist, z: this.pos.z - Math.cos(this.yaw) * dist }; }
}
