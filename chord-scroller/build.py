import json, glob, os, sys
S = os.path.dirname(os.path.abspath(__file__))
songs = [json.load(open(p, encoding="utf-8")) for p in sorted(glob.glob(os.path.join(S, "songs", "*.json")))]
songs.sort(key=lambda s: s["id"])
# starting tempos (rough guesses; the page lets you change them and remembers your setting)
BPM = {1: 76, 2: 68, 3: 80, 4: 88, 5: 76, 6: 74, 7: 72, 8: 96, 9: 70, 10: 112, 11: 118, 12: 120}
for s in songs: s.setdefault("bpm", BPM.get(s["id"], 80))
tpl = open(os.path.join(S, "template.html"), encoding="utf-8").read()
page = tpl.replace("__SONGS__", json.dumps(songs, ensure_ascii=False, separators=(",", ":")))
open(os.path.join(S, "chords.html"), "w", encoding="utf-8").write(page)
# standalone copy for the repo (full document skeleton)
full = ('<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n'
        '</head>\n<body>\n' + page + '\n</body>\n</html>\n')
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(S, "index.html")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8").write(full)
print(len(songs), "songs ->", out)
