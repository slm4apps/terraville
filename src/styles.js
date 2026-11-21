// SPDX-License-Identifier: Apache-2.0
// styles.js -- a STYLE is a bundle of looks and defaults that CODE owns, picked by ONE word from the model ("in gta style", "make it minecraft"). It is a mood and a way of
// building, not a copy of any game: people ask for "minecraft-like", "roblox-like", "gta-like" worlds and objects in their own words and get the style's look.
//   voxel  : terrain heights snap to this many metres (blocky ground) and recipes are snapped to a cube grid
//   flat   : flat-shaded faces (no smooth shading)     sat : colour saturation multiplier     light : sun strength multiplier
//   treeBox: trees and rocks built from boxes          sky : [day, night] sky colours          fog : fog distance multiplier
//   biome  : used when the sentence named no biome (the model's default 'grassland')            water : same for water
//   features: added when the sentence named none        loot : [[item name from the library, count]] scattered to collect        zone : a shrinking safe-zone ring
export const STYLES = {
  minecraft: { voxel: 1, flat: true, sat: 1.15, treeBox: true, sky: [0x8ec6ff, 0x0a1030], loot: [['chest', 4], ['torch', 6], ['diamond', 5]] },
  roblox:    { flat: true, sat: 1.7, light: 1.25, treeBox: true, sky: [0x6fd0ff, 0x10163a], loot: [['coin', 24]] },
  gta:       { sat: 1.1, sky: [0xffa86b, 0x1a0b2e], fog: 0.8, biome: 'beach', water: 'sea', features: [{ name: 'tower', count: 4 }, { name: 'village', count: 3 }, { name: 'road', count: 3 }], loot: [['sports car', 4], ['pistol', 4]] },
  pubg:      { sat: 0.85, sky: [0xaab4bd, 0x0c1018], fog: 0.9, biome: 'island', water: 'sea', features: [{ name: 'village', count: 3 }, { name: 'ruins', count: 2 }, { name: 'tower', count: 1 }], loot: [['airdrop crate', 10], ['medkit', 8], ['rifle', 6], ['helmet', 6], ['backpack', 6]], zone: true },
  fortnite:  { sat: 1.5, flat: true, sky: [0x7fd3ff, 0x14143a], biome: 'island', water: 'sea', features: [{ name: 'village', count: 2 }, { name: 'tower', count: 2 }], loot: [['treasure chest', 6], ['shotgun', 5], ['shield pickup', 6]], zone: true },
  zelda:     { sat: 1.25, sky: [0x9fdcff, 0x1a2a4a], fog: 1.2, biome: 'grassland', features: [{ name: 'ruins', count: 3 }, { name: 'camp', count: 1 }, { name: 'tower', count: 1 }], loot: [['key', 3], ['heart', 6]] },
  mario:     { sat: 1.7, flat: true, light: 1.2, sky: [0x5c94fc, 0x1a1a5a], treeBox: true, loot: [['gold coin', 30], ['star', 3]] },
  cyberpunk: { sat: 1.4, light: 0.8, sky: [0x3a1066, 0x120022], fog: 0.7, features: [{ name: 'tower', count: 5 }, { name: 'road', count: 3 }], loot: [['street lamp', 6]] },
  medieval:  { sat: 0.95, sky: [0xa8c8e0, 0x101828], biome: 'grassland', features: [{ name: 'village', count: 3 }, { name: 'tower', count: 2 }, { name: 'ruins', count: 1 }], loot: [['sword', 3], ['shield', 3]] },
  western:   { sat: 1.0, sky: [0xf2c27a, 0x1c1020], biome: 'desert', features: [{ name: 'camp', count: 2 }, { name: 'ruins', count: 2 }, { name: 'village', count: 1 }], loot: [['revolver', 3], ['barrel', 6]] },
  apocalypse:{ sat: 0.5, light: 0.8, sky: [0x7a7a66, 0x14140e], fog: 0.55, biome: 'desert', features: [{ name: 'ruins', count: 4 }, { name: 'camp', count: 1 }], loot: [['barrel', 6], ['medkit', 4], ['fuel can', 4]] },
  cartoon:   { sat: 1.6, flat: true, light: 1.1, sky: [0x8fe0ff, 0x1a1a4a] },
  lowpoly:   { flat: true, sat: 1.1, sky: [0x9ad0f0, 0x0b1530] },
  realistic: { sat: 0.9, sky: [0x9ac0e0, 0x0b1530] },
};

/** saturate a THREE.Color in place */
export function saturate(c, k) { if (k === 1) return c; const h = {}; c.getHSL(h); return c.setHSL(h.h, Math.min(1, h.s * k), h.l); }

/** a library recipe restyled: voxel styles snap sizes and positions to a cube grid, others recolour (done by the builder via sat) */
export function styleRecipe(recipe, style) {
  const st = STYLES[style]; if (!st || !st.voxel) return recipe;
  const q = 0.25, snap = (v) => Math.max(q, Math.round(v / q) * q);
  return { ...recipe, parts: recipe.parts.map((p) => ['cube', snap(p[1]), snap(p[2]), snap(p[3]), Math.round(p[4] / q) * q, Math.round(p[5] / q) * q, Math.round(p[6] / q) * q, p[7]]) };
}

/** what the SCREEN calls each style: generic words, no game brand names on the page. The model's internal token
 *  names stay as they are (people may still type "minecraft style"); only the display changes. */
export const STYLE_LABELS = { minecraft: 'voxel', roblox: 'toy brick', gta: 'sunny city', pubg: 'battle island', fortnite: 'bright island', zelda: 'fantasy adventure', mario: 'platformer',
  cyberpunk: 'neon city', medieval: 'medieval', western: 'wild west', apocalypse: 'wasteland', cartoon: 'cartoon', lowpoly: 'low poly', realistic: 'realistic' };
export const styleLabel = (s) => STYLE_LABELS[s] || s;
