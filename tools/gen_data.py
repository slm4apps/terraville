#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""gen_data.py -- synthetic training data for the world-spec model: sample a SPEC first, then write a request that says it in many ways. The label is the
spec itself, so it is exact by construction (no teacher, no stand-in parser in the loop). The system prompt is read from the page's own code (dump_vocab.mjs),
byte for byte. Phrasings are split: TRAIN_TEMPLATES for training, HELD_TEMPLATES only for the held-out test.

    node tools/dump_vocab.mjs > data/vocab.json && python3 tools/gen_data.py   ->  data/{train,val,test}.jsonl, data/report.json
"""
import collections
import json
import os
import random
import re

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "..", "data")
V = json.load(open(os.path.join(D, "vocab.json")))
VOC, SYSTEM, GOLD = V["vocab"], V["system"], V["gold"]

BIOME_WORDS = {
    "forest": ["forest", "woods", "woodland", "jungle", "forest land"],
    "desert": ["desert", "dune desert", "arid desert", "sandy desert"],
    "snow": ["snowy land", "arctic land", "frozen tundra", "snow field", "icy land", "winter land"],
    "grassland": ["grassland", "meadow", "prairie", "plains with grass", "green fields"],
    "mountains": ["mountains", "mountain range", "alps", "rocky peaks"],
    "swamp": ["swamp", "marsh", "bog", "wetland"],
    "beach": ["beach", "sandy shore", "coast", "seaside"],
    "island": ["island", "small island", "tropical island", "archipelago"],
}
TERRAIN_WORDS = {"flat": ["flat", "level", "very flat"], "hilly": ["hilly", "rolling", "with rolling hills", "with gentle hills"], "steep": ["steep", "rugged", "jagged", "with cliffs"]}
WATER_WORDS = {"lake": ["a lake", "a pond", "a big lake"], "river": ["a river", "a winding river", "a stream"], "sea": ["the sea", "an ocean", "the sea nearby"]}
TIME_WORDS = {"night": ["at night", "under the moon", "in the dark", "at midnight"], "day": ["during the day", "in bright daylight", "on a sunny day", "at noon"]}
PLANT_WORDS = {"trees": ["trees", "forest cover"], "rocks": ["rocks", "boulders", "stones"], "grass": ["grass"], "flowers": ["flowers"], "crystals": ["crystals", "gems"]}
DENS_PRE = {"dense": ["dense", "lots of", "thick", "many"], "sparse": ["sparse", "a few", "scattered", "few"], "none": ["no"]}
FEAT_WORDS = {"village": ["village", "villages"], "ruins": ["ruins", "old ruins"], "road": ["road", "roads"], "bridge": ["bridge", "bridges"], "tower": ["tower", "towers"], "camp": ["camp", "camps"], "cave": ["cave", "caves"]}
NUMS = {1: ["a", "one"], 2: ["two"], 3: ["three"], 4: ["four"], 5: ["five"]}
TARGET_WORDS = {"crystals": ["crystals", "gems"], "flowers": ["flowers"], "rocks": ["rocks", "stones"], "trees": ["trees"]}
OBJ_WORDS = {"lamp": ["lamp", "lantern", "street lamp"], "bench": ["bench", "seat"], "hut": ["hut", "cabin", "small house"]}
TOOL_PHRASES = {
    "dig": ["dig a {size} hole", "dig here", "dig a hole in the ground", "start digging a {size} pit", "I want to dig a {size} hole", "dig down here", "make a {size} hole in the ground", "dig a {size} trench"],
    "place": ["place it here", "put that down", "drop the object here", "place the object", "put it there", "set it down", "place this in front of me", "drop it"],
    "light": ["add a light", "put a light here", "place a torch", "give me some light", "I need a light", "light this place up", "put a torch down", "add a lamp light here"],
    "pickup": ["pick it up", "pick up the object", "grab that", "pick that up", "take it", "pick up the thing in front of me", "take that object", "remove that object"],
}
SAY = [("hi there", "Hi! Tell me a world, an object or a small game to make."), ("hey", "Hi! Tell me a world, an object or a small game to make."), ("help", "I can make worlds, simple objects and small games like collecting things."), ("who are you", "I turn your words into worlds, objects and simple games."), ("tell me a joke", "I only make worlds, objects and simple games."), ("what time is it", "I only make worlds, objects and simple games."), ("save the world", "I cannot save yet."), ("make it multiplayer", "I cannot do multiplayer yet."), ("ok", "Tell me what to make next."), ("good job", "You are welcome."), ("hello", "Hi! Tell me a world, an object or a small game to make."), ("what can you do", "I can make worlds, simple objects and small games like collecting things."),
       ("write me a poem", "I only make worlds, objects and simple games."), ("what is the weather", "I only make worlds, objects and simple games."),
       
       ("thanks", "You are welcome."), ("delete everything", "I can only make or change worlds and objects."), ("play music", "I cannot play music.")]

# ---- phrasing templates (the held-out ones are never used for training) ----
TRAIN_TEMPLATES = ["{a} {terr} {biome} {water_ph}{feat_ph}{dens_ph}{time_ph}", "make me {a} {terr} {biome} {water_ph}{feat_ph}{dens_ph}{time_ph}", "I want {a} {terr} {biome}{water_ph}{feat_ph}{dens_ph}{time_ph}",
                   "build {a} {biome} that is {terr}{water_ph}{feat_ph}{dens_ph}{time_ph}", "create {a} {terr} {biome} {time_ph2}{water_ph}{feat_ph}{dens_ph}", "{time_ph2} {a} {terr} {biome}{water_ph}{feat_ph}{dens_ph}",
                   # The word "world" only ever came with a style ("cube world" = minecraft), so the model added Y:minecraft to any unseen "... world" request.
                   # Style-free "world" phrasings and explore-type verbs (none equal to HELD_TEMPLATES) teach that "world" / "explore" say nothing about style.
                   "{a} {terr} {biome} world{water_ph}{feat_ph}{dens_ph}{time_ph}", "make {a} {terr} {biome} world{water_ph}{feat_ph}{dens_ph}{time_ph}",
                   "a world that is {a} {terr} {biome}{water_ph}{feat_ph}{dens_ph}{time_ph}", "i want to explore {a} {terr} {biome}{water_ph}{feat_ph}{dens_ph}{time_ph}",
                   "let me wander {a} {terr} {biome}{water_ph}{feat_ph}{dens_ph}{time_ph}", "new world: {a} {terr} {biome}{water_ph}{feat_ph}{dens_ph}{time_ph}"]
HELD_TEMPLATES = ["generate {a} {terr} {biome} world{water_ph}{feat_ph}{dens_ph}{time_ph}", "let me explore {a} {terr} {biome}{water_ph}{feat_ph}{dens_ph}{time_ph}"]


def pick(rnd, xs):
    return xs[rnd.randrange(len(xs))]


def article(w):
    return "an" if w[0] in "aeiou" else "a"


def sample_world(rnd, patch=False):
    s = {"kind": "patch" if patch else "world"}
    if not patch or rnd.random() < 0.5:
        s["biome"] = pick(rnd, VOC["biome"])
    if not patch:
        s["terrain"] = rnd.choice(VOC["terrain"]); s["water"] = "none"; s["time"] = rnd.choice(VOC["time"])
        if s["biome"] in ("island", "beach"):
            s["water"] = "sea"
        elif rnd.random() < 0.55:
            s["water"] = rnd.choice(["lake", "river", "sea"])
        if rnd.random() < 0.45:
            plants = rnd.sample(VOC["plants"], rnd.choice([1, 1, 2])); s["density"] = {p: rnd.choice(["sparse", "dense", "none"] if rnd.random() < 0.2 else ["sparse", "dense"]) for p in plants}
        if rnd.random() < 0.5:
            fs = rnd.sample(VOC["feature"], rnd.choice([1, 1, 2, 3])); s["features"] = [{"name": f, "count": rnd.choice([1, 1, 1, 2, 3])} for f in fs]
        if rnd.random() < 0.15:
            s["game"] = {"game": "collect", "target": rnd.choice(VOC["target"]), "count": rnd.choice([3, 5, 5, 8, 10])}
    return s


def render_world(s, rnd, templates):
    biome = pick(rnd, BIOME_WORDS[s["biome"]])
    terr = pick(rnd, TERRAIN_WORDS[s["terrain"]]) if s["terrain"] != "hilly" or rnd.random() < 0.6 else ""
    if "with" in terr:                          # "with rolling hills" reads better after the noun
        biome, terr = biome + " " + terr, ""
    water_ph = ""
    if s["water"] != "none" and not (s["biome"] in ("island", "beach") and rnd.random() < 0.6):
        water_ph = " with " + pick(rnd, WATER_WORDS[s["water"]])
    feats = s.get("features", [])
    feat_ph = ""
    if feats:
        parts = []
        for f in feats:
            w = pick(rnd, FEAT_WORDS[f["name"]]); n = f["count"]
            if n == 1 and f["name"] == "ruins":
                parts.append(pick(rnd, ["some", "old"]) + " ruins")
            elif n == 1:
                w = FEAT_WORDS[f["name"]][0]; parts.append(pick(rnd, ["a", "one"]) + " " + w)
            else:
                w = [x for x in FEAT_WORDS[f["name"]] if x.endswith("s")][0]; parts.append(pick(rnd, NUMS.get(n, [str(n)])) + " " + w)
        feat_ph = (" and " if water_ph else " with ") + ", ".join(parts[:-1]) + (" and " if len(parts) > 1 else "") + parts[-1]
    dens = s.get("density", {})
    dens_ph = ""
    if dens:
        bits = [pick(rnd, DENS_PRE[d]) + " " + pick(rnd, PLANT_WORDS[p]) for p, d in dens.items()]
        dens_ph = ", " + " and ".join(bits)
    time_ph2 = pick(rnd, TIME_WORDS[s["time"]]) if s["time"] == "night" or rnd.random() < 0.3 else ""
    time_ph = (" " + time_ph2) if time_ph2 else ""
    game = s.get("game")
    g_ph = ""
    if game:
        g_ph = ". " + pick(rnd, ["collect ", "find ", "gather "]) + str(game["count"]) + " " + pick(rnd, TARGET_WORDS[game["target"]])
    tpl = pick(rnd, templates)
    use_time2 = "{time_ph2}" in tpl
    text = tpl.format(a=article(terr or biome), terr=terr, biome=biome, water_ph=water_ph, feat_ph=feat_ph, dens_ph=dens_ph, time_ph=("" if use_time2 else time_ph), time_ph2=time_ph2)
    out = " ".join((text + g_ph).split()).strip(" ,")
    out = re.sub(r"\b([Aa]) ([aeiouAEIOU])", lambda m: m.group(1) + "n " + m.group(2), out)
    out = re.sub(r"\b([Aa])n ([^aeiouAEIOU\W])", lambda m: m.group(1) + " " + m.group(2), out)
    return out


def sample_patch(rnd):
    t = rnd.choice(["time", "density", "water", "terrain", "feature", "game", "biome"])
    s = {"kind": "patch"}
    if t == "time":
        s["time"] = rnd.choice(VOC["time"]); txt = pick(rnd, ["make it {w}", "{w}", "switch to {w}", "change it to {w}"]).format(w=pick(rnd, TIME_WORDS[s["time"]]) if rnd.random() < 0.7 else s["time"])
        if txt in ("night", "day"):
            txt = "make it " + txt
    elif t == "density":
        p = rnd.choice(VOC["plants"]); d = rnd.choice(["sparse", "dense", "none"]); s["density"] = {p: d}
        w = pick(rnd, PLANT_WORDS[p]); txt = {"dense": pick(rnd, ["more {w}", "make the {w} denser", "add lots of {w}", "much more {w}"]), "sparse": pick(rnd, ["fewer {w}", "make the {w} sparse", "a few {w} only", "less {w}"]), "none": pick(rnd, ["no {w}", "remove all {w}", "get rid of the {w}"])}[d].format(w=w)
    elif t == "water":
        s["water"] = rnd.choice(["lake", "river", "sea"]); txt = pick(rnd, ["add {w}", "put {w} here", "now with {w}"]).format(w=pick(rnd, WATER_WORDS[s["water"]]))
    elif t == "terrain":
        s["terrain"] = rnd.choice(VOC["terrain"]); w = {"flat": ["flatter", "flat"], "hilly": ["hillier", "hilly"], "steep": ["steeper", "steep and rugged"]}[s["terrain"]]; txt = pick(rnd, ["make it {w}", "make the land {w}"]).format(w=pick(rnd, w))
    elif t == "feature":
        f = rnd.choice(VOC["feature"]); n = rnd.choice([1, 1, 2]); s["features"] = [{"name": f, "count": n}]
        txt = pick(rnd, ["add a {w}", "put a {w} here", "also a {w}"]).format(w=FEAT_WORDS[f][0]) if n == 1 else pick(rnd, ["add two {w}", "now with two {w}"]).format(w=[x for x in FEAT_WORDS[f] if x.endswith("s")][0])
    elif t == "game":
        g = {"game": "collect", "target": rnd.choice(VOC["target"]), "count": rnd.choice([3, 5, 8, 10])}; s["game"] = g
        txt = pick(rnd, ["collect {n} {w}", "make it a game: find {n} {w}", "let me gather {n} {w}"]).format(n=g["count"], w=pick(rnd, TARGET_WORDS[g["target"]]))
    else:
        s["biome"] = rnd.choice(VOC["biome"]); txt = pick(rnd, ["turn it into {a} {b}", "change it to {a} {b}", "now make it {a} {b}"]).format(b=pick(rnd, BIOME_WORDS[s["biome"]]), a="")
        txt = " ".join(txt.split())
    return s, txt


def sample_object(rnd):
    name = rnd.choice(VOC["object"]); parts = json.loads(json.dumps(GOLD[name])); col = None
    if rnd.random() < 0.5:
        col = rnd.choice(VOC["color"]); parts[0]["color"] = col
    w = pick(rnd, OBJ_WORDS[name]); c = (col + " ") if col else ""
    txt = pick(rnd, ["build a {c}{w}", "make me a {c}{w}", "I want a {c}{w}", "create a {c}{w}", "give me a {c}{w}", "put a {c}{w} here"]).format(c=c, w=w)
    return {"kind": "object", "name": name, "parts": parts}, txt


def sample_tool(rnd):
    t = rnd.choice(VOC["tool"]); size = rnd.choice(VOC["toolSize"]); s = {"kind": "tool", "tool": t, "size": size if t == "dig" else "medium"}
    txt = pick(rnd, TOOL_PHRASES[t]).format(size=size)
    return s, txt


def row(user, spec, split, kind):
    return {"split": split, "kind": kind, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}, {"role": "assistant", "content": json.dumps(spec, separators=(",", ":"))}]}


def build(rnd, n, split, templates, mix):
    rows, seen = [], set()
    while len(rows) < n:
        k = rnd.choices(["world", "patch", "object", "tool", "say"], weights=mix)[0]
        if k == "world":
            s = sample_world(rnd); txt = render_world(s, rnd, templates)
        elif k == "patch":
            s, txt = sample_patch(rnd)
        elif k == "object":
            s, txt = sample_object(rnd)
        elif k == "tool":
            s, txt = sample_tool(rnd)
        else:
            txt, say = rnd.choice(SAY); s = {"kind": "say", "text": say}
        if rnd.random() < 0.3:
            txt = txt.capitalize()
        if rnd.random() < 0.15:
            txt = txt.rstrip(".") + pick(rnd, [" please", ", thanks", ""])
        key = (txt, json.dumps(s, sort_keys=True))
        if k in ("world", "patch", "object") and key in seen:
            continue
        if k in ("tool", "say") and sum(1 for r in rows[-400:] if r["messages"][1]["content"] == txt) >= 2:
            continue
        seen.add(key); rows.append(row(txt, s, split, k))
    return rows


def main():
    rnd = random.Random(20261117)
    mix = [0.52, 0.16, 0.14, 0.1, 0.08]
    train = build(rnd, 4200, "train", TRAIN_TEMPLATES, mix)
    held = {r["messages"][1]["content"] for r in train}
    val = [r for r in build(rnd, 400, "val", TRAIN_TEMPLATES, mix) if r["messages"][1]["content"] not in held][:150]
    test_in = [r for r in build(rnd, 600, "test_seen_phrasing", TRAIN_TEMPLATES, mix) if r["messages"][1]["content"] not in held][:200]
    test_held = [r for r in build(rnd, 600, "test_held_phrasing", HELD_TEMPLATES, [1, 0, 0, 0, 0]) if r["messages"][1]["content"] not in held][:100]
    for name, rows in (("train", train), ("val", val), ("test", test_in + test_held)):
        with open(os.path.join(D, name + ".jsonl"), "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    rep = {"train": len(train), "val": len(val), "test": len(test_in) + len(test_held), "train_kinds": dict(collections.Counter(r["kind"] for r in train)),
           "avg_answer_chars": round(sum(len(r["messages"][2]["content"]) for r in train) / len(train))}
    json.dump(rep, open(os.path.join(D, "report.json"), "w"), indent=1); print(json.dumps(rep))


if __name__ == "__main__":
    main()
