// SPDX-License-Identifier: Apache-2.0
// the item probe's prompts, shared by tools/probe_library.mjs (node) and the visible page test (?probe=1)
// [category, prompt, expected library name or null when we only check that SOMETHING sensible comes back]
export const PROMPTS = [
  ...['chair', 'sofa', 'bed', 'table', 'bookshelf', 'refrigerator', 'toilet', 'bicycle', 'backpack', 'umbrella', 'guitar', 'piano', 'teapot', 'laptop', 'street lamp', 'mailbox', 'traffic light', 'fire hydrant', 'park bench', 'barrel'].map((n) => ['everyday', `build a ${n}`, n]),
  ...[['a small house', 'house'], ['a cottage', 'cottage'], ['a two story house', 'house'], ['a house with a red roof', 'house'], ['a gable roof', 'roof'], ['a flat roof house', 'house'], ['a castle', 'castle'], ['a barn', 'barn'], ['a skyscraper', 'skyscraper'], ['a lighthouse', 'lighthouse'], ['a garage', 'garage'], ['a church', 'church'], ['a windmill', 'windmill'], ['a shop', 'shop'], ['a hospital', 'hospital'], ['a gas station', 'gas station']].map(([w, n]) => ['buildings', `build ${w}`, n]),
  ...['rifle', 'shotgun', 'sniper rifle', 'pistol', 'sword', 'shield', 'medkit', 'helmet', 'flamethrower', 'airdrop crate', 'sports car', 'tank', 'helicopter', 'turret', 'grenade', 'crossbow'].map((n) => ['game items', `make a ${n}`, n]),
  ...['zombie', 'knight', 'robot', 'wizard', 'soldier', 'dragon', 'pirate', 'ninja', 'skeleton', 'police officer'].map((n) => ['characters', `spawn a ${n}`, n]),
  ...['unicorn', 'hot air balloon', 'tesla coil', 'submarine', 'spaceship', 'ferris wheel', 'snowman', 'treehouse', 'jukebox', 'volcano', 'pirate ship', 'catapult'].map((n) => ['unseen', `build a ${n}`, n]),
  ...[['a house with a chimney and a garden', 'house'], ['a red car next to a tree', 'car'], ['three benches around a fountain', 'bench'], ['a table with four chairs', 'table'], ['a lamp on a desk', 'lamp']].map(([w, n]) => ['compound', `make ${w}`, n]),
  ...['a train station', 'a christmas street', 'a living room', 'a kitchen', 'a small village', 'a playground'].map((w) => ['scenes', `build ${w}`, null]),
];
