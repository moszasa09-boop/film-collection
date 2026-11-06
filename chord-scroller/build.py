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
    # a file that holds only {"id": ...} (and "ref": true) points at a song stored in another folder,
    # so one song can be in several gigs without copying it
    refs = []
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
        folder_ids = []
        for n, f in enumerate(files, 1):
            with open(os.path.join(path, f), encoding="utf-8") as fh:
                song = json.load(fh)
            sid = song.get("id")
            if not sid or not ID_RE.match(sid):
                sys.exit(f"{folder}/{f}: missing or bad \"id\" (use 4-40 lowercase letters/digits)")
            if song.get("ref"):
                refs.append((folder, f, sid))
            else:
                if sid in seen and seen[sid] != song:
                    sys.exit(f"{folder}/{f}: id {sid} is already used by another song")
                if sid not in seen:
                    seen[sid] = song
                    songs.append(song)
            folder_ids.append(sid)
        # order and per-gig settings: "rows" in _event.json, else file-name order.
        # Row ids depend on the gig and the song only (not the position), so reordering keeps them.
        rows = meta.get("rows") or [{"song": sid} for sid in folder_ids]
        count = {}
        for n, row in enumerate(rows, 1):
            sid = row["song"]
            if sid not in folder_ids:
                sys.exit(f"{folder}/_event.json: row {n} names song {sid}, which has no file in this folder")
            count[sid] = count.get(sid, 0) + 1
            iid = "i" + h(event_id + ":" + sid + ("" if count[sid] == 1 else ":" + str(count[sid])))
            items.append({"id": iid, "eventId": event_id, "setId": set_id, "songId": sid, "order": n * 1000,
                          "shift": row.get("shift", 0), "capo": row.get("capo", 0), "bpm": row.get("bpm"),
                          "singer": row.get("singer", ""), "note": row.get("note", "")})
    for folder, f, sid in refs:
        if sid not in seen:
            sys.exit(f"{folder}/{f}: points at song {sid}, which no folder contains")
    return {"songs": songs, "events": events, "items": items}


def arg(name):
    """Value after a command-line flag, e.g. --out file.html (used by the tests)."""
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else None


def build(artifact):
    css = open(os.path.join(SRC, "style.css"), encoding="utf-8").read()
    js_dir = os.path.join(SRC, "js")
    js = "\n".join(open(os.path.join(js_dir, f), encoding="utf-8").read() for f in sorted(os.listdir(js_dir)) if f.endswith(".js"))
    builtin = json.dumps(load_builtin(), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = open(os.path.join(SRC, "page.html"), encoding="utf-8").read()
    # Supabase (band sync on the public link): only when cloud.json gives a project, and never in the
    # claude.ai build, which has its own shared database.
    cloud = None
    cloud_path = arg("--cloud") or os.path.join(HERE, "cloud.json")
    if not artifact and os.path.exists(cloud_path):
        with open(cloud_path, encoding="utf-8") as fh:
            cfg = json.load(fh)
        if cfg.get("url") and cfg.get("anonKey"):
            cloud = {"url": cfg["url"].rstrip("/"), "anonKey": cfg["anonKey"]}
    vendor = ""
    if cloud:
        with open(os.path.join(HERE, "vendor", "supabase-js-2.119.0.umd.js"), encoding="utf-8") as fh:
            vendor = "<script>\n" + fh.read().replace("</script", "<\\/script") + "\n</script>"
    publish = None
    if not artifact and os.path.exists(os.path.join(HERE, "publish.json")):
        with open(os.path.join(HERE, "publish.json"), encoding="utf-8") as fh:
            publish = json.load(fh)
    page = page.replace("/*__VENDOR__*/", vendor).replace("/*__CLOUD__*/", json.dumps(cloud)).replace("/*__PUBLISH__*/", json.dumps(publish))
    page = page.replace("/*__CSS__*/", css).replace("/*__BUILTIN__*/", builtin).replace("/*__JS__*/", js)
    if artifact:
        out, html = os.path.join(HERE, "chords.html"), page
    else:
        out = arg("--out") or os.path.join(HERE, "index.html")
        html = ('<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
                'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n' + page + '\n</body>\n</html>\n')
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    if not artifact and not arg("--out"):
        sw = open(os.path.join(SRC, "sw.js"), encoding="utf-8").read().replace("__VERSION__", hashlib.sha1(html.encode("utf-8")).hexdigest()[:12])
        with open(os.path.join(HERE, "sw.js"), "w", encoding="utf-8") as fh:
            fh.write(sw)
    b = load_builtin()
    print(f"{len(b['events'])} starter gig(s), {len(b['songs'])} songs, band sync {'ON (' + cloud['url'] + ')' if cloud else 'off'} -> {out} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    build("--artifact" in sys.argv)
