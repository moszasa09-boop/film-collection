"""Build index.html from template.html and the song folders in setlists/.

Each folder in setlists/ is one group (a gig or a set list). Every .json file in it is one song;
songs play in file-name order, so start names with 01-, 02-, ...
Usage:  python3 build.py            -> writes index.html (open it in any browser)
        python3 build.py --artifact -> writes chords.html (no <html>/<head> wrapper)
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SETS_DIR = os.path.join(HERE, "setlists")

sets = []
for name in sorted(os.listdir(SETS_DIR)):
    folder = os.path.join(SETS_DIR, name)
    if not os.path.isdir(folder):
        continue
    songs = []
    for f in sorted(os.listdir(folder)):
        if f.endswith(".json"):
            with open(os.path.join(folder, f), encoding="utf-8") as fh:
                songs.append(json.load(fh))
    if songs:
        sets.append({"name": name, "songs": songs})

with open(os.path.join(HERE, "template.html"), encoding="utf-8") as fh:
    page = fh.read().replace("__SETS__", json.dumps(sets, ensure_ascii=False, separators=(",", ":")))

if "--artifact" in sys.argv:
    out, html = os.path.join(HERE, "chords.html"), page
else:
    out = os.path.join(HERE, "index.html")
    html = ('<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n' + page + '\n</body>\n</html>\n')
with open(out, "w", encoding="utf-8") as fh:
    fh.write(html)
print(f"{len(sets)} folder(s), {sum(len(s['songs']) for s in sets)} songs -> {out}")
