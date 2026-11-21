// SPDX-License-Identifier: Apache-2.0
// game.js -- game rules are CODE; the model only picks a template and its words ({game:"collect", target:"crystals", count:5}).
import * as THREE from 'three';

export class Game {
  constructor(scene, world, player, say) {
    this.scene = scene; this.world = world; this.player = player; this.say = say;
    this.targets = []; this.total = 0; this.got = 0; this.spec = null; this.group = new THREE.Group(); scene.add(this.group); this.t = 0;
  }
  start(spec) {
    this.clear(); this.spec = spec;
    if (!spec) return;
    if (spec.game === 'survive') return;
    if (spec.game !== 'collect') { this.say(`The "${spec.game}" game is in the vocabulary but not in this POC. Try: "collect 5 crystals".`); return; }
    this.total = spec.count; this.got = 0;
    const colors = { crystals: 0x5fe0ff, flowers: 0xff6fa5, rocks: 0xb0b0b0, trees: 0x2f9f46 };
    for (let i = 0; i < this.total; i++) {
      const a = (i / this.total) * Math.PI * 2 + 0.4, r = 24 + (i % 3) * 16 + 10, x = this.player.pos.x + Math.cos(a) * r, z = this.player.pos.z + Math.sin(a) * r;
      const y = Math.max(this.world.height(x, z), this.world.terrain.waterLevel) + 1.1;
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshBasicMaterial({ color: colors[spec.target] || 0x5fe0ff }));
      m.position.set(x, y, z); this.group.add(m); this.targets.push(m);
    }
    this.say(`Collect ${this.total} ${spec.target}: look for the glowing shapes.`);
  }
  update(dt) {
    this.t += dt;
    for (const m of this.targets) { m.rotation.y += dt * 1.6; m.position.y += Math.sin(this.t * 2 + m.position.x) * dt * 0.3; }
    for (const m of [...this.targets]) {
      if (Math.hypot(m.position.x - this.player.pos.x, m.position.z - this.player.pos.z) < 2.6 && Math.abs(m.position.y - this.player.pos.y) < 4) {
        this.group.remove(m); m.geometry.dispose(); m.material.dispose(); this.targets.splice(this.targets.indexOf(m), 1); this.got++;
        this.say(this.got >= this.total ? `You collected all ${this.total}. You win.` : `${this.got} / ${this.total}`);
      }
    }
  }
  hud() { return this.spec && this.spec.game === 'collect' ? `collect ${this.got}/${this.total}` : ''; }
  clear() { for (const m of this.targets) { m.geometry.dispose(); m.material.dispose(); } this.targets = []; this.group.clear(); this.spec = null; this.total = this.got = 0; }
}
