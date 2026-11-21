#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""gen_tiny.py -- data for the TINY from-scratch model (a ~6 MB transformer that lives in the browser).
Input  = the request as characters (lowercase, a small alphabet). Output = a SHORT sequence of closed-vocabulary tokens (no JSON syntax to learn):
    K:world B:forest T:hilly W:lake D:night P:trees=dense F:village N:2 G:collect X:crystals N:5
The code (JS and Python, same rules) turns the tokens back into a spec; the spec goes through validate() like any other.
Specs are sampled first and the sentence is written from them (gen_data.py), so labels are exact. Augmentation: typos, filler words, held-out synonyms.

    node tools/dump_vocab.mjs > data/vocab.json && python3 tools/gen_tiny.py   ->  data/tiny/{train,val,test}.jsonl, vocab.json, report.json
"""
import collections
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_data as G  # noqa: E402

D = os.path.join(HERE, "..", "data")
T = os.path.join(D, "tiny")
os.makedirs(T, exist_ok=True)
V = G.V
VOC = V["vocab"]
SAY_MSG = V["say_messages"]
LIB = json.load(open(os.path.join(D, "library", "names.json"))) if os.path.exists(os.path.join(D, "library", "names.json")) else {"names": [], "synonyms": {}}
_AX = os.path.join(D, "library", "aliases_extra.json")
if os.path.exists(_AX):                                   # hand-picked aliases: a plain-English phrase -> the library name it should land on
    for _k, _v in json.load(open(_AX)).items():
        LIB["synonyms"][_k] = sorted(set(LIB["synonyms"].get(_k, [])) | set(_v))
OBJ = sorted(set(VOC["object"]) | set(LIB["names"]))
STYLE_WORDS = {"minecraft": ["minecraft", "voxel", "blocky voxel", "cube world"], "roblox": ["roblox", "blocky toy", "lego like", "brick toy"], "gta": ["gta", "grand theft auto", "gta 5", "vice city"],
               "pubg": ["pubg", "battle royale", "erangel", "warzone"], "fortnite": ["fortnite", "fortnite like"], "zelda": ["zelda", "breath of the wild", "fantasy adventure"],
               "mario": ["mario", "super mario", "platformer"], "cyberpunk": ["cyberpunk", "neon city", "blade runner"], "medieval": ["medieval", "middle ages"], "western": ["wild west", "western", "cowboy"],
               "apocalypse": ["post apocalyptic", "apocalypse", "wasteland", "fallout"], "cartoon": ["cartoon", "toon", "cel shaded"], "lowpoly": ["low poly", "low-poly", "lowpoly"], "realistic": ["realistic", "photorealistic", "lifelike"]}

# ---- output tokens ----
SPECIAL = ["<pad>", "<bos>", "<eos>"]
OUT = SPECIAL + ["K:" + k for k in VOC["kind"]] + ["B:" + b for b in VOC["biome"]] + ["T:" + t for t in VOC["terrain"]] + ["W:" + w for w in VOC["water"]] + ["D:" + t for t in VOC["time"]]
OUT += ["P:%s=%s" % (p, l) for p in VOC["plants"] for l in VOC["density"]] + ["Y:" + y for y in VOC["style"]] + ["F:" + f for f in VOC["feature"]] + ["G:" + g for g in VOC["game"]] + ["X:" + t for t in VOC["target"]]
OUT += ["N:%d" % n for n in range(1, 31)] + ["O:" + o for o in OBJ] + ["C:" + c for c in VOC["color"]] + ["L:" + t for t in VOC["tool"]] + ["S:" + s for s in VOC["toolSize"]]
OUT += ["M:%d" % i for i in range(len(SAY_MSG))]
OUT += ["A:" + a for a in VOC["aspect"]] + ["E:" + d for d in VOC["dir"]]
OID = {t: i for i, t in enumerate(OUT)}
# ---- input alphabet ----
CHARS = ["<pad>", "<unk>"] + list(" abcdefghijklmnopqrstuvwxyz0123456789,.'-!?")
CID = {c: i for i, c in enumerate(CHARS)}
MAX_IN, MAX_OUT = 112, 30


def encode_spec(s):
    k = s["kind"]
    t = ["K:" + k]
    if s.get("style"):
        t.append("Y:" + s["style"])
    if k in ("world", "patch"):
        for key, pre in (("biome", "B"), ("terrain", "T"), ("water", "W"), ("time", "D")):
            if key in s:
                t.append(f"{pre}:{s[key]}")
        for p in VOC["plants"]:
            if p in s.get("density", {}):
                t.append(f"P:{p}={s['density'][p]}")
        for f in s.get("features", []):
            t += ["F:" + f["name"], "N:%d" % f["count"]]
        if "game" in s:
            g = s["game"]; t.append("G:" + g["game"])
            if g["game"] == "collect":
                t += ["X:" + g["target"], "N:%d" % g["count"]]
    elif k == "object":
        t.append("O:" + s["name"])
        if s.get("color"):
            t.append("C:" + s["color"])
        if s.get("count", 1) > 1:
            t.append("N:%d" % s["count"])
    elif k == "tool":
        t += ["L:" + s["tool"], "S:" + s["size"]]
    elif k == "adjust":
        t += ["A:" + s["aspect"], "E:" + s["dir"]]
    elif k == "say":
        t.append("M:%d" % SAY_MSG.index(s["text"]))
    return t


def decode_tokens(toks):
    """tokens -> spec dict (the same rules as src/tinylm.js); None when the sequence is not a valid spec"""
    toks = [x for x in toks if x not in SPECIAL]
    if not toks or not toks[0].startswith("K:"):
        return None
    k = toks[0][2:]; s = {"kind": k}; i = 1
    if k in ("world", "patch"):
        while i < len(toks):
            x = toks[i]; a, b = x.split(":", 1)
            if a == "Y":
                s["style"] = b
            elif a in "BTWD":
                s[{"B": "biome", "T": "terrain", "W": "water", "D": "time"}[a]] = b
            elif a == "P":
                p, lvl = b.split("="); s.setdefault("density", {})[p] = lvl
            elif a == "F":
                n = 1
                if i + 1 < len(toks) and toks[i + 1].startswith("N:"):
                    n = int(toks[i + 1][2:]); i += 1
                s.setdefault("features", []).append({"name": b, "count": n})
            elif a == "G":
                g = {"game": b}
                if b == "collect":
                    if i + 2 < len(toks) + 0 and toks[i + 1].startswith("X:"):
                        g["target"] = toks[i + 1][2:]; i += 1
                        if i + 1 < len(toks) and toks[i + 1].startswith("N:"):
                            g["count"] = int(toks[i + 1][2:]); i += 1
                s["game"] = g
            else:
                return None
            i += 1
    elif k == "object":
        if i < len(toks) and toks[i].startswith("Y:"):
            s["style"] = toks[i][2:]; i += 1
        if i >= len(toks) or not toks[i].startswith("O:"):
            return None
        s["name"] = toks[i][2:]; i += 1
        for x in toks[i:]:
            if x.startswith("Y:"):
                s["style"] = x[2:]
                continue
            if x.startswith("C:"):
                s["color"] = x[2:]
            elif x.startswith("N:"):
                s["count"] = int(x[2:])
    elif k == "tool":
        if len(toks) < 3 or not toks[1].startswith("L:") or not toks[2].startswith("S:"):
            return None
        s.update({"tool": toks[1][2:], "size": toks[2][2:]})
    elif k == "adjust":
        if len(toks) < 3 or not toks[1].startswith("A:") or not toks[2].startswith("E:"):
            return None
        s.update({"aspect": toks[1][2:], "dir": toks[2][2:]})
    elif k == "say":
        if len(toks) < 2 or not toks[1].startswith("M:"):
            return None
        s["text"] = SAY_MSG[int(toks[1][2:])]
    return s


# ---- augmentation ----
FILL_PRE = ["please ", "can you ", "could you ", "hey ", "i'd like ", "i would like ", "ok ", "now ", "quick: ", "um ", "show me ", "take me to ", "i'd love ", "drop me into ", "put me in ", "teleport me to ", "can we have ", "how about ", "let's see ", "i feel like ", "start with ", "bring up ", "set up ", "load ", "go to ", "i am in the mood for ", "surprise me with ", "i fancy ", "we need ", "time for ", "i want to roam ", "let me walk around ", "show me a world with ", "world please: ", "a whole world, "]
FILL_POST = [" please", " thanks", " now", " for me", " quickly", " again"]


def typo(rnd, t):
    if len(t) < 6:
        return t
    i = rnd.randrange(1, len(t) - 1); r = rnd.random()
    if r < 0.4 and t[i].isalpha():
        return t[:i] + t[i + 1:]                       # drop a char
    if r < 0.7:
        return t[:i] + t[i + 1] + t[i] + t[i + 2:]     # swap two
    return t[:i] + t[i] + t[i:]                        # double a char


def augment(rnd, text):
    t = text.lower()
    if rnd.random() < 0.40:
        t = rnd.choice(FILL_PRE) + t
    if rnd.random() < 0.15:
        t = t + rnd.choice(FILL_POST)
    if rnd.random() < 0.10:
        t = typo(rnd, t)
    if rnd.random() < 0.25:
        t = t.rstrip(".") + rnd.choice([".", "!", ""])
    return t[:MAX_IN]


# ---- held-out synonyms: removed from training, used only in one test split ----
HELD_SYN = {"BIOME_WORDS": {"forest": ["woodland"], "desert": ["arid desert"], "snow": ["icy land"], "island": ["tropical island"], "swamp": ["wetland"], "mountains": ["alps"]},
            "WATER_WORDS": {"lake": ["a pond"], "river": ["a stream"], "sea": ["an ocean"]}}


def with_synonyms(held):
    saved = {n: {k: list(v) for k, v in getattr(G, n).items()} for n in HELD_SYN}
    for n, table in HELD_SYN.items():
        cur = getattr(G, n)
        for k, words in table.items():
            keep = [w for w in saved[n][k] if w not in words]
            cur[k] = (words if held else keep) or saved[n][k]
    return saved


def restore(saved):
    for n, t in saved.items():
        setattr(G, n, t)


# every verb means the same thing: add / make / spawn / place / get ... a X.  Verbs are crossed with items uniformly so the model learns "the verb does not matter".
VERBS = ["add", "make", "build", "create", "spawn", "place", "put", "drop", "give me", "get me", "make me", "build me", "craft", "forge", "construct", "generate", "summon", "bring me", "bring in", "produce", "install", "set up", "pull out", "grab", "equip", "i want", "i need", "i would like", "can i have", "gimme", "let me have", "i want to make", "put down", "throw in", "insert", "make some",
         "fetch", "fetch me", "hand me", "pass me", "show me", "assemble", "fabricate", "invent", "dream up", "cook up", "rustle up", "knock up", "carve", "sculpt",
         "deploy", "buy", "order", "erect", "raise", "lay down", "pop in", "toss in", "draw", "design", "render", "cast", "manifest", "unlock", "plant", "set down", "shape"]
# verb invariance (held verbs at 60.6 %, gate 80): a share of item requests use a MADE-UP verb, so the model learns the verb never names the item
FAKE_VERB = lambda rnd: "".join(rnd.choice("bdfgklmnprstvz") + rnd.choice("aeiou") for _ in range(rnd.randint(2, 3))) + rnd.choice(["", " up", " me", " in"])
HELD_VERBS = ["conjure", "whip up", "materialize"]            # never in training: tools/verb_probe.mjs checks them
OBJ_T = [v + " {a} {w}" for v in VERBS] + ["{a} {w}", "{w}", "{a} {w} please", "one {w}", "add one {w}", "{w} here", "a {w} over here", "{a} {w} now"]
OBJ_T_HELD = [v + " {a} {w}" for v in HELD_VERBS]
OBJ_TN = [v + " {n} {p}" for v in ["give me", "add", "spawn", "drop", "scatter", "put", "build", "make", "place", "create", "summon", "bring me", "get me", "craft", "generate"]] + ["{n} {p}", "{n} {p} here", "{n} {p} please"]


def plural(w):
    if w.endswith("s") or w.endswith("ss"):
        return w
    if w.endswith(("ch", "sh", "x", "z")):
        return w + "es"
    if w.endswith("y") and w[-2:-1] not in "aeiou":
        return w[:-1] + "ies"
    return w + "s"


_SX = os.path.join(D, "library", "synonyms_extra.json")       # stand-in names must be TAUGHT, never held out
ALWAYS_TRAIN = {w for k, v in (json.load(open(_SX)).items() if os.path.exists(_SX) else []) if not k.startswith("_") for w in v}


def syn_held(w):
    import zlib
    return w not in ALWAYS_TRAIN and zlib.crc32(w.encode()) % 10 >= 7                     # a stable 30 % of synonyms is held out of training


_NP = os.path.join(D, "library", "maris_not_popular.txt")
_NOTPOP = set(l.strip() for l in open(_NP)) if os.path.exists(_NP) else set()
POPN = [n for n in LIB["names"] if n not in _NOTPOP] or LIB["names"]          # the popular names (game and daily-life items) get half of the object rows


def sample_lib_object(rnd, held):
    name = rnd.choice(POPN if rnd.random() < 0.5 else LIB["names"]); sy = LIB["synonyms"].get(name, [])
    pool = [w for w in sy if syn_held(w) == held] if held else [name] + [w for w in sy if not syn_held(w)]
    if not pool:
        pool = [name] if not held else None
    if pool is None:
        return None
    w = rnd.choice(pool); s = {"kind": "object", "name": name}
    if rnd.random() < 0.15:
        st = rnd.choice(VOC["style"]); s["style"] = st; w = style_word(rnd, st, held) + " style " + w
    if rnd.random() < 0.25:
        s["color"] = rnd.choice(VOC["color"]); w = s["color"] + " " + w
    if rnd.random() < 0.3:
        s["count"] = rnd.choice([2, 2, 3, 3, 4, 5, 5, 6, 8, 10, 12])
        txt = rnd.choice(OBJ_TN).format(n=s["count"], p=plural(w))
    else:
        a_ = "an" if w[0] in "aeiou" else "a"
        txt = (FAKE_VERB(rnd) + " {a} {w}" if not held and rnd.random() < 0.06 else rnd.choice(OBJ_T)).format(a=a_, w=w)
    return {"text": augment(rnd, txt), "tokens": encode_spec(s), "kind": "object", "spec": s}


def style_word(rnd, st, held):
    ws = STYLE_WORDS[st]; pool = [w for w in ws if syn_held(w) == held] if held else [w for w in ws if not syn_held(w)] or ws
    return rnd.choice(pool or ws)


def add_style(rnd, text, spec, held):
    st = rnd.choice(VOC["style"]); w = style_word(rnd, st, held); spec["style"] = st
    return rnd.choice(["{w} style {t}", "{t} in {w} style", "{t}, {w} style", "{t} like in {w}", "{w} version of {t}", "{w}-style {t}"]).format(w=w, t=text)



# ---- live game ADJUSTMENTS ("make it harder", "zombies faster", "more scrap"): what to change + which way. The running pack says what each means. ----
ADJ = {
    ("difficulty", "up"): ["make it harder", "harder please", "increase the difficulty", "more difficult", "tougher game", "crank up the difficulty", "bring it on", "hardcore mode", "i want a challenge", "this is too easy", "too easy", "raise the difficulty", "turn up the heat", "make the game harder"],
    ("difficulty", "much_up"): ["make it much harder", "nightmare mode", "way harder", "insane difficulty", "impossible mode", "maximum difficulty", "make it a lot harder", "much more difficult", "brutal mode"],
    ("difficulty", "down"): ["make it easier", "easier please", "lower the difficulty", "this is too hard", "too hard", "go easy on me", "less difficult", "calm it down", "easy mode", "make the game easier", "ease up", "dial it back"],
    ("difficulty", "much_down"): ["make it much easier", "way easier", "baby mode", "super easy", "minimum difficulty", "make it a lot easier", "much less difficult", "casual mode"],
    ("speed", "up"): ["zombies faster", "make the zombies faster", "speed them up", "they are too slow", "faster enemies", "make them run", "zombies should run faster", "turbo zombies", "make enemies faster", "the zombies are too slow", "faster zombies", "they should move faster", "make them quicker", "speed up the zombies"],
    ("speed", "down"): ["zombies slower", "slow them down", "they are too fast", "make the zombies slower", "slower enemies", "zombies are too fast", "slower zombies", "make enemies slower", "slow the zombies down", "they move too fast", "make them slower"],
    ("health", "up"): ["tougher zombies", "make zombies stronger", "zombies have more health", "beefier enemies", "zombies are too weak", "harder to kill", "more health for zombies", "make the zombies tougher", "give them more health", "stronger enemies", "zombies should take more hits"],
    ("health", "down"): ["weaker zombies", "zombies are too tough", "less health for zombies", "easier to kill", "make zombies weaker", "make the zombies weaker", "give them less health", "zombies die faster", "squishier zombies", "zombies take too many hits"],
    ("damage", "up"): ["zombies hit harder", "more damage from zombies", "zombies deal more damage", "make their attacks stronger", "make zombies hit harder", "stronger attacks", "they should hurt more", "zombie bites hurt more", "increase zombie damage"],
    ("damage", "down"): ["zombies hit softer", "less damage from zombies", "weaker attacks", "zombies hurt less", "make zombies hit softer", "they hit too hard", "reduce zombie damage", "zombies hit too hard", "zombie bites hurt less"],
    ("spawn", "up"): ["more zombies", "spawn more zombies", "bigger waves", "more enemies", "a bigger horde", "zombies spawn faster", "flood me with zombies", "bring more zombies", "add more enemies", "bigger horde please", "increase the zombie count", "send more zombies"],
    ("spawn", "down"): ["fewer zombies", "less zombies", "smaller waves", "fewer enemies", "thin the horde", "spawn less", "fewer zombies please", "a smaller horde", "reduce the zombie count", "send fewer zombies", "not so many zombies", "too many zombies"],
    ("scrap", "up"): ["more scrap", "give me more scrap", "i need scrap", "i am out of scrap", "give me resources", "more materials", "i am broke", "add scrap", "i need more resources", "give me some scrap", "scrap please", "more resources please", "i ran out of scrap", "i need materials"],
    ("scrap", "much_up"): ["give me lots of scrap", "loads of scrap", "a ton of scrap", "give me heaps of resources", "lots of scrap please", "give me a ton of materials", "tons of scrap", "i need a lot of scrap"],
    ("wave", "up"): ["next wave", "send the next wave", "bring the next wave", "skip to the next wave", "start the next wave", "next wave now", "hurry up the wave", "send the next wave now", "i am ready for the next wave", "skip ahead to the next wave", "call the next wave"],
}


def sample_adjust(rnd, held):
    """one adjustment row; held=True uses ONLY phrases held out of training (a stable 30 % by hash), held=False uses the rest"""
    for _ in range(50):
        (aspect, d), phrases = rnd.choice(list(ADJ.items()))
        pool = [p for p in phrases if syn_held(p) == held]
        if pool:
            s = {"kind": "adjust", "aspect": aspect, "dir": d}
            return {"text": augment(rnd, rnd.choice(pool)), "tokens": encode_spec(s), "kind": "adjust", "spec": s}
    return None


def make(rnd, n, templates, mix, held_syn=False):
    saved = with_synonyms(held_syn)
    try:
        w = list(mix); share = w[2] if len(w) > 2 else 0; w[2] = 0
        rows = G.build(rnd, int(n * (1 - share)) if sum(w) else 0, "x", templates, w) if sum(w) else []
    finally:
        restore(saved)
    out = []
    for _ in range(int(n * share) if LIB["names"] else 0):
        r = sample_lib_object(rnd, held_syn)
        if r:
            out.append(r)
    for r in rows:
        spec = json.loads(r["messages"][2]["content"])
        if spec["kind"] == "object":
            pass
        text = r["messages"][1]["content"]
        if spec["kind"] in ("world", "patch") and rnd.random() < (0.35 if not held_syn else 0.6):
            text = add_style(rnd, text, spec, held_syn)
        out.append({"text": augment(rnd, text), "tokens": encode_spec(spec), "kind": r["kind"], "spec": spec})
    for _ in range(int(n * 0.04)):                                   # style-only patches: "make it minecraft style"
        st = rnd.choice(VOC["style"]); w = style_word(rnd, st, held_syn); spec = {"kind": "patch", "style": st}
        out.append({"text": augment(rnd, rnd.choice(["make it {w} style", "now {w} style", "turn it into a {w} world", "{w} style please", "change to {w} style"]).format(w=w)), "tokens": encode_spec(spec), "kind": "patch", "spec": spec})
    return out


def boost_rows(rnd, per=12):
    """extra item rows for what games need (data/library/gaps/genre_needs.json) and the stand-in names (synonyms_extra.json): each WORD gets `per` rows."""
    words = {}
    gp = os.path.join(D, "library", "gaps", "genre_needs.json")
    if os.path.exists(gp):
        alias = {w: k for k, v in LIB["synonyms"].items() for w in v if not syn_held(w)}
        for g, items in json.load(open(gp)).items():
            if not g.startswith("_"):
                for w in items:
                    n = w if w in LIB["names"] else alias.get(w)
                    if n:
                        words[w] = n
    if os.path.exists(_SX):
        for n, ws in json.load(open(_SX)).items():
            if not n.startswith("_") and n in LIB["names"]:
                for w in ws:
                    words[w] = n
    out = []
    for w, n in sorted(words.items()):
        for _ in range(per):
            txt = (FAKE_VERB(rnd) + " {a} {w}" if rnd.random() < 0.06 else rnd.choice(OBJ_T)).format(a="an" if w[0] in "aeiou" else "a", w=w)
            s = {"kind": "object", "name": n}
            out.append({"text": augment(rnd, txt), "tokens": encode_spec(s), "kind": "object", "spec": s})
    print("boost rows:", len(out), "for", len(words), "words")
    return out


def main():
    rnd = random.Random(20261118)
    mix = [0.40, 0.12, 0.42, 0.10, 0.08]
    train = make(rnd, 80000, G.TRAIN_TEMPLATES, mix)
    train += [r for r in (sample_adjust(rnd, False) for _ in range(9000)) if r]
    train += boost_rows(rnd); rnd.shuffle(train)
    seen = {r["text"] for r in train}
    def cut(rows, n):                                                # SHUFFLE before cutting: make() lists library objects first, so a plain [:n] kept only objects
        rows = [r for r in rows if r["text"] not in seen]; rnd.shuffle(rows); return rows[:n]
    val = cut(make(rnd, 1200, G.TRAIN_TEMPLATES, mix), 600)
    t_seen = cut(make(rnd, 2000, G.TRAIN_TEMPLATES, mix), 400)                       # every kind, phrasings like training
    t_phr = cut(make(rnd, 2000, G.HELD_TEMPLATES, [1, 0, 0, 0, 0]), 300)              # WORLD requests in sentence templates never trained on
    t_syn = cut(make(rnd, 2600, G.TRAIN_TEMPLATES, [0.6, 0, 0.4, 0, 0], held_syn=True), 300)   # worlds AND items named with synonyms never trained on
    t_seen += [r for r in (sample_adjust(rnd, False) for _ in range(120)) if r and r["text"] not in seen][:60]
    t_syn += [r for r in (sample_adjust(rnd, True) for _ in range(120)) if r][:60]
    val += [r for r in (sample_adjust(rnd, False) for _ in range(120)) if r][:60]
    for r in t_seen: r["split"] = "test_seen"
    for r in t_phr: r["split"] = "test_held_phrasing"
    for r in t_syn: r["split"] = "test_held_synonyms"
    # round trip: tokens -> spec must give back the sampled spec (seed aside)
    bad = 0
    for r in train[:3000] + t_seen + t_phr + t_syn:
        back = decode_tokens(r["tokens"]); want = json.loads(json.dumps(r["spec"])); want.pop("seed", None)
        if back != want:
            bad += 1
            if bad <= 3:
                print("ROUNDTRIP DIFF", r["tokens"], back, want)
    assert bad == 0, f"{bad} round-trip failures"
    for name, rows in (("train", train), ("val", val), ("test", t_seen + t_phr + t_syn)):
        with open(os.path.join(T, name + ".jsonl"), "w") as f:
            for r in rows:
                f.write(json.dumps({k: r[k] for k in ("text", "tokens", "kind", "spec") + (("split",) if "split" in r else ())}) + "\n")
    json.dump({"chars": CHARS, "out": OUT, "max_in": MAX_IN, "max_out": MAX_OUT, "say": SAY_MSG}, open(os.path.join(T, "vocab.json"), "w"))
    rep = {"train": len(train), "val": len(val), "test_seen": len(t_seen), "test_held_phrasing": len(t_phr), "test_held_synonyms": len(t_syn), "out_vocab": len(OUT), "in_vocab": len(CHARS),
           "kinds": dict(collections.Counter(r["kind"] for r in train)), "max_tokens": max(len(r["tokens"]) for r in train) + 2, "max_chars": max(len(r["text"]) for r in train)}
    json.dump(rep, open(os.path.join(T, "report.json"), "w"), indent=1); print(json.dumps(rep))


if __name__ == "__main__":
    main()
