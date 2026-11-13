// Pure-function checks run inside the built page (device mode): text format round trip on every
// starter song, chord recognition, transposition, capo, the chords-above converter, backup checks.
const { chromium } = require('playwright');
const path = require('path');
const file = 'file://' + path.resolve(__dirname, '../index.html');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(file); await p.waitForTimeout(500);
  const res = await p.evaluate(() => {
    const A = window.ChordApp, out = [];
    const ok = (c, m) => out.push([!!c, m]);
    const songs = BUILTIN.songs;
    const byId = id => songs.find(s => s.id === id).blocks;
    const KONTAI = byId("s820c2f20e69"), HAMJAI = byId("sd0631e0d315");   // ก่อนตาย, ห้ามใจ
    // 1. every starter song survives text -> blocks -> text unchanged
    for (const s of songs) {
      const t = A.blocksToText(s.blocks);
      const r = A.textToBlocks(t);
      const same = JSON.stringify(r.blocks) === JSON.stringify(s.blocks.map(b => { const c = { ...b }; return c; }));
      let diff = "";
      if (!same) { for (let i = 0; i < Math.max(r.blocks.length, s.blocks.length); i++) if (JSON.stringify(r.blocks[i]) !== JSON.stringify(s.blocks[i])) { diff = ` first diff block ${i}: ${JSON.stringify(s.blocks[i]).slice(0, 160)} VS ${JSON.stringify(r.blocks[i]).slice(0, 160)}`; break; } }
      ok(same && !r.errors.length, `round trip ${s.title}${r.errors.length ? " errors " + JSON.stringify(r.errors) : ""}${diff}`);
    }
    // 2. every chord in the starter songs is recognised
    const bad = [];
    for (const s of songs) for (const b of s.blocks) {
      if (b.type === "instru") b.bars.forEach(bar => bar.split(/\s+/).forEach(c => { if (!A.isChord(c)) bad.push(c); }));
      if (b.type === "lines") b.lines.forEach(l => l.forEach(([c]) => { if (c && !A.isChord(c)) bad.push(c); }));
    }
    ok(!bad.length, "all starter chords recognised " + bad.join(","));
    // the RISK @Central Rama 2 gig: 3 breaks of 8, 9 and 15 songs, no song twice
    const risk = BUILTIN.items.filter(i => i.eventId === "erisk13nov26");
    const per = ["b1", "b2", "b3"].map(id => risk.filter(i => i.setId === id).length).join(",");
    ok(BUILTIN.events.find(e => e.id === "erisk13nov26").sets.map(x => x.name).join() === "เบรค 1,เบรค 2,เบรค 3" && per === "8,9,15" && new Set(risk.map(i => i.songId)).size === 32, "RISK gig has 3 breaks of 8, 9, 15 songs " + per);
    for (const c of ["Am", "C#m7", "D/F#", "Bbmaj7", "Gsus4", "Cadd9", "E7b9", "F#m7b5", "Bdim", "Caug", "(C)", "Am?", "DmM7", "G#/C"]) ok(A.isChord(c), "chord " + c);
    for (const c of ["H", "Cm#x", "ไม่", "C/", "Am7?x", "hello", "C##"]) ok(!A.isChord(c), "not a chord " + c);
    // 3. transposition
    const T = [["D/F#", 2, "E/G#"], ["Bbm", 1, "Bm"], ["G#/C", -1, "G/B"], ["(C)", 2, "(D)"], ["C#", -1, "C"], ["Ebm", 12, "Ebm"], ["B", 1, "C"], ["C", -1, "B"], ["F#m7b5", 3, "Am7b5"], ["DmM7", -2, "CmM7"]];
    for (const [c, s, w] of T) ok(A.tr(c, s) === w, `tr(${c},${s}) = ${A.tr(c, s)} want ${w}`);
    ok(A.keyOf(KONTAI, 0) === "C#" && A.keyOf(KONTAI, 2) === "Eb", "key of ก่อนตาย C#, +2 = Eb");
    ok(A.keyOf(HAMJAI, 0) === "Em", "key of ห้ามใจ Em");
    // capo 2 on a C# song shows B shapes: shift - capo
    ok(A.tr("C#", 0 - 2) === "B" && A.tr("Ebm", -2) === "C#m", "capo 2 shapes");
    // 4. chords-above converter keeps chords over the right Thai syllable (tone marks take no column)
    const conv = A.convertChordsAbove("C#        F#\nเราทุกคนก็คงรู้วันเกิด\n\nEm\nฉันรักเธอ");
    ok(conv.text.split("\n")[0] === "[C#]เราทุกคนก็คง[F#]รู้วันเกิด", "convert Thai line: " + conv.text.split("\n")[0]);
    ok(conv.text.split("\n")[2] === "[Em]ฉันรักเธอ", "convert simple line: " + conv.text.split("\n")[2]);
    const conv2 = A.convertChordsAbove("G    D\n");
    ok(conv2.text.trim() === "[G] [D]", "chord-only line converts to marks: " + conv2.text.trim());
    // 5. parser errors and markers
    const e1 = A.textToBlocks("[Xm]ฮา\n[Am ไม่ปิด");
    ok(e1.errors.length >= 2, "bad chord and unbalanced bracket reported " + JSON.stringify(e1.errors));
    const e2 = A.textToBlocks("[INTRO] | Em | C | ( 2 Times )\n| G | D |\n\n## ฮุค\n* [Am?]ร้อง {?เพลง}\n> ( ซ้ำ * )\n> ( Till End )");
    ok(e2.blocks.length === 5 && e2.blocks[1].label === "" && e2.blocks[2].section === "ฮุค" && e2.blocks[4].type === "end", "format features parse " + JSON.stringify(e2.blocks).slice(0, 200));
    const st = A.songStats({ blocks: e2.blocks });
    ok(st.unclear === 2, "unclear markers counted " + st.unclear);
    const v = A.validateSong({ title: "", bpm: -120, blocks: [] }, { errors: [], warnings: [] }, []);
    ok(v.errors.some(e => e.field === "title") && v.errors.some(e => e.field === "bpm"), "validation: empty title and negative BPM rejected");
    const v2 = A.validateSong({ title: "x", bpm: 300.5, blocks: e2.blocks }, null, []);
    ok(v2.errors.some(e => e.field === "bpm"), "validation: BPM 300.5 rejected");
    // 6. English lyrics count as lyrics
    ok(A.songStats({ blocks: A.textToBlocks("[G]Hello [D]world").blocks }).ready, "English lyrics are ready");
    // 7. timing: repeat notes expand, BPM drives length
    const t80 = A.songSeconds(HAMJAI, 80), t160 = A.songSeconds(HAMJAI, 160);
    ok(Math.abs(t80 - 2 * t160) < 0.01, "length halves at double BPM");
    ok(A.analyse(HAMJAI).some(x => /ซ้ำ/.test(x.name || "")), "ห้ามใจ repeats are written out");
    ok(A.songSeconds(HAMJAI, -5) === A.songSeconds(HAMJAI, 80), "bad BPM falls back to 80");
    // 8. backup checks
    ok(A.checkBackup("not json").fatal, "backup: non-JSON rejected");
    ok(A.checkBackup('{"format":"other"}').fatal, "backup: other format rejected");
    const cb = A.checkBackup(JSON.stringify({ format: "chordscroll-backup", version: 1, songs: [{ id: "ok1", title: "a", blocks: [] }, { id: "../x", title: "b", blocks: [] }, { id: "ok2", title: "", blocks: [] }], events: [{ id: "ev1", name: "e", sets: [{ id: "m", name: "s" }] }], items: [{ id: "it1", eventId: "ev1", songId: "ok1", setId: "m", order: 1, bpm: -3, capo: 40 }, { id: "it2", eventId: "nope", songId: "ok1", setId: "m", order: 2 }] }));
    ok(cb.songs.length === 1 && cb.items.length === 1 && cb.items[0].bpm === null && cb.items[0].capo === 11 && cb.problems.length >= 3, "backup: bad entries skipped and values clamped " + JSON.stringify(cb.problems));
    return out;
  });
  let fails = 0;
  for (const [pass, m] of res) { console.log((pass ? "PASS " : "FAIL ") + m); if (!pass) fails++; }
  console.log(fails ? `${fails} FAILED of ${res.length}` : `ALL ${res.length} PASSED`);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
