"""Build the app from src/ and the song folders in setlists/.

    python3 build.py              -> index.html  (open in any browser; this is what GitHub Pages serves)
    python3 build.py --artifact   -> chords.html (the same app without the <html>/<head> wrapper, for claude.ai)

Each folder in setlists/ becomes a starter gig (one set, songs in file-name order: 01-, 02-, ...).
An optional _event.json in the folder sets {"name", "date", "venue", "note", "slotMinutes"}.
Every song file needs a permanent "id" (letters/digits); the build stops if one is missing or repeated,
so ids never change when files are renamed or reordered.
"""
import hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
SETS_DIR = os.path.join(HERE, "setlists")
ID_RE = re.compile(r"^[a-z0-9]{4,40}$")


def h(text, n=11):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:n]


def load_builtin():
    songs, events, items, seen = [], [], [], {}
    for folder in sorted(os.listdir(SETS_DIR)):
        path = os.path.join(SETS_DIR, folder)
        if not os.path.isdir(path):
            continue
        meta = {}
        if os.path.exists(os.path.join(path, "_event.json")):
            with open(os.path.join(path, "_event.json"), encoding="utf-8") as fh:
                meta = json.load(fh)
        event_id = meta.get("id") or "e" + h("setlist:" + folder)
        set_id = "main"
        events.append({
            "id": event_id, "name": meta.get("name", folder), "date": meta.get("date", ""),
            "venue": meta.get("venue", ""), "note": meta.get("note", ""), "slotMinutes": meta.get("slotMinutes"),
            "sets": [{"id": set_id, "name": "เซ็ตหลัก"}],
        })
        files = sorted(f for f in os.listdir(path) if f.endswith(".json") and not f.startswith("_"))
        for n, f in enumerate(files, 1):
            with open(os.path.join(path, f), encoding="utf-8") as fh:
                song = json.load(fh)
            sid = song.get("id")
            if not sid or not ID_RE.match(sid):
                sys.exit(f"{folder}/{f}: missing or bad \"id\" (use 4-40 lowercase letters/digits)")
            if sid in seen and seen[sid] != song:
                sys.exit(f"{folder}/{f}: id {sid} is already used by another song")
            if sid not in seen:
                seen[sid] = song
                songs.append(song)
            items.append({"id": "i" + h(event_id + ":" + sid + ":" + str(n)), "eventId": event_id, "setId": set_id,
                          "songId": sid, "order": n * 1000, "shift": 0, "capo": 0, "bpm": None, "singer": "", "note": ""})
    return {"songs": songs, "events": events, "items": items}


def build(artifact):
    css = open(os.path.join(SRC, "style.css"), encoding="utf-8").read()
    js_dir = os.path.join(SRC, "js")
    js = "\n".join(open(os.path.join(js_dir, f), encoding="utf-8").read() for f in sorted(os.listdir(js_dir)) if f.endswith(".js"))
    builtin = json.dumps(load_builtin(), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = open(os.path.join(SRC, "page.html"), encoding="utf-8").read()
    page = page.replace("/*__CSS__*/", css).replace("/*__BUILTIN__*/", builtin).replace("/*__JS__*/", js)
    if artifact:
        out, html = os.path.join(HERE, "chords.html"), page
    else:
        out = os.path.join(HERE, "index.html")
        html = ('<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
                'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n' + page + '\n</body>\n</html>\n')
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    if not artifact:
        sw = open(os.path.join(SRC, "sw.js"), encoding="utf-8").read().replace("__VERSION__", hashlib.sha1(html.encode("utf-8")).hexdigest()[:12])
        with open(os.path.join(HERE, "sw.js"), "w", encoding="utf-8") as fh:
            fh.write(sw)
    b = load_builtin()
    print(f"{len(b['events'])} starter gig(s), {len(b['songs'])} songs -> {out} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    build("--artifact" in sys.argv)
