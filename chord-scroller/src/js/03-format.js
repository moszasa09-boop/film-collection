/* ---------- song text format ----------
   One song as plain text, easy to type, paste or fix by hand:

     [INTRO] | Em | Em | C | C | ( 2 Times )     a box of bars (INTRO, INSTRU, OUTRO, SOLO ...)
     | C | C | C | C |                            more bars of the box above
     ## ฮุค                                        name the next stanza (optional)
     [Em]สุดท้าย.. ต่อให้เหนี่ยว [Am]รั้งสักเท่าไหร่   chord in brackets right before the syllable under it
                                                  (blank line) = new stanza
     > ( ซ้ำ * , ** )                              a note; "( Till End )" marks the end
     [Am?]  {?คำ}                                  "?" = read unclearly from the picture; check before trusting
*/
const INSTRU_RE = /^\s*\[?\s*(INTRO|INSTRU(?:MENTS?|MENTAL)?|OUTRO|SOLO|ENDING|BREAK|INTERLUDE|อินโทร|ดนตรี|โซโล่|เอาท์โทร|ท่อนจบ)\s*\]?\s*:?\s*(.*)$/i;

function blocksToText(blocks) {
  const out = [];
  let prev = null;
  for (const b of blocks || []) {
    if (b.type === "lines") {
      if (out.length) out.push("");
      if (b.section) out.push("## " + b.section);
      for (const l of b.lines) out.push(l.map(([c, t]) => (c ? "[" + c + "]" : "") + (t || "")).join("").replace(/\s+$/, ""));
    } else if (b.type === "instru") {
      if (out.length && !(prev && prev.type === "instru" && !b.label)) out.push("");
      const bars = "| " + (b.bars || []).join(" | ") + " |";
      out.push((b.label ? "[" + b.label + "] " : "") + bars + (b.note ? " " + b.note : ""));
    } else if (b.type === "note" || b.type === "end") {
      if (out.length) out.push("");
      out.push("> " + b.text);
    }
    prev = b;
  }
  return out.join("\n") + (out.length ? "\n" : "");
}

/** Parse the text format. Never throws: problems come back as errors (block saving) or warnings. */
function textToBlocks(text) {
  const blocks = [], errors = [], warnings = [];
  let stanza = null, section = null, lastWasInstru = false;
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const close = () => { if (stanza && stanza.lines.length) blocks.push(stanza); stanza = null; };
  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { close(); lastWasInstru = false; return; }
    const t = line.trim();
    if (t.startsWith("## ")) { close(); section = t.slice(3).trim() || null; lastWasInstru = false; return; }
    if (t.startsWith(">")) {
      close();
      const body = t.replace(/^>\s*/, "");
      blocks.push(/till\s*end|^\(?\s*จบ\s*\)?$/i.test(body) ? { type: "end", text: body } : { type: "note", text: body });
      lastWasInstru = false; return;
    }
    const im = INSTRU_RE.exec(t);
    const contBars = lastWasInstru && t.startsWith("|");
    if ((im && im[2].includes("|")) || contBars) {
      close();
      const label = contBars ? "" : im[1];
      const rest = contBars ? t : im[2];
      const lastPipe = rest.lastIndexOf("|");
      const barsPart = rest.slice(0, lastPipe + 1), note = rest.slice(lastPipe + 1).trim();
      const bars = barsPart.split("|").map(s => s.trim()).filter(Boolean);
      bars.forEach(bar => bar.split(/\s+/).forEach(c => { if (!isChord(c)) errors.push({ line: n, msg: `คอร์ด “${c}” ในกล่อง ${label || "ดนตรี"} ไม่ใช่รูปแบบคอร์ด` }); }));
      if (!bars.length) errors.push({ line: n, msg: "กล่องดนตรีไม่มีคอร์ด ใส่แบบ | Em | C |" });
      blocks.push({ type: "instru", label, bars, note });
      lastWasInstru = true; return;
    }
    lastWasInstru = false;
    // lyric line with [Chord] marks
    const segs = [];
    let pos = 0, cur = ["", ""], bad = false;
    const re = /\[([^\]\n]*)\]/g;
    let m;
    while ((m = re.exec(line))) {
      cur[1] += line.slice(pos, m.index);
      if (cur[0] || cur[1]) segs.push(cur);
      const c = m[1].trim();
      if (!c) { errors.push({ line: n, msg: "มีวงเล็บ [ ] ว่าง" }); bad = true; }
      else if (!isChord(c)) { errors.push({ line: n, msg: `“${c}” ไม่ใช่รูปแบบคอร์ด (เช่น Am, C#m7, D/F#)` }); bad = true; }
      cur = [c, ""];
      pos = re.lastIndex;
    }
    cur[1] += line.slice(pos);
    if (cur[0] || cur[1]) segs.push(cur);
    if (/[\[\]]/.test(segs.map(s => s[1]).join(""))) { errors.push({ line: n, msg: "วงเล็บ [ ] ไม่ครบคู่" }); bad = true; }
    const opens = (line.match(/\{\?/g) || []).length, closes = (line.match(/\}/g) || []).length;
    if (opens !== closes) errors.push({ line: n, msg: "เครื่องหมายจุดไม่ชัด {? … } ไม่ครบคู่" });
    if (!stanza) { stanza = { type: "lines", lines: [] }; if (section) { stanza.section = section; section = null; } }
    if (!bad || segs.length) stanza.lines.push(segs.length ? segs : [["", line]]);
  });
  close();
  return { blocks, errors, warnings };
}

/* "Chords on their own line above the lyrics" (how most chord sites and PDFs print it) → [Chord] marks.
   Thai vowels and tone marks above/below a consonant take no column, so they are skipped when counting. */
const ZW = /[ัิ-ฺ็-๎̀-ͯ]/;
function colToIndex(s, col) {
  let c = 0;
  for (let i = 0; i < s.length; i++) {
    if (ZW.test(s[i])) continue;
    if (c === col) return i;
    c++;
  }
  return -1;
}
function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(t => t && t !== "|");
  return toks.length > 0 && toks.every(isChord) && !/\[/.test(line);
}
function convertChordsAbove(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const out = [];
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!isChordLine(L) || INSTRU_RE.test(L.trim())) { out.push(L); continue; }
    const chords = [];
    const re = /\S+/g; let m;
    while ((m = re.exec(L))) if (m[0] !== "|") chords.push({ col: m.index, c: m[0] });
    const next = lines[i + 1];
    if (next == null || !next.trim() || isChordLine(next) || next.trim().startsWith(">") || next.trim().startsWith("##")) {
      out.push(chords.map(x => "[" + x.c + "]").join(" ")); changed++; continue;
    }
    let lyric = next.replace(/\s+$/, "");
    for (let k = chords.length - 1; k >= 0; k--) {
      let idx = colToIndex(lyric, chords[k].col);
      if (idx < 0) { lyric = lyric + " ".repeat(Math.max(1, chords[k].col - [...lyric].filter(ch => !ZW.test(ch)).length)); idx = lyric.length; }
      // keep a chord at the start of a Thai syllable: never on a mark, a trailing vowel (ะ า ำ),
      // or the final consonant after ั (ฝั|น → |ฝัน)
      while (idx < lyric.length && ZW.test(lyric[idx])) idx++;
      if (idx > 0 && /[\u0E30\u0E32\u0E33\u0E45]/.test(lyric[idx] || "")) idx--;
      if (idx > 1 && lyric[idx - 1] === "\u0E31") idx -= 2;
      lyric = lyric.slice(0, idx) + "[" + chords[k].c + "]" + lyric.slice(idx);
    }
    out.push(lyric.replace(/\s+$/, ""));
    changed++; i++;
  }
  return { text: out.join("\n"), changed };
}

/** Check a song before saving. Errors block saving; warnings are shown but allowed. */
function validateSong(song, parsed, others) {
  const errors = [...(parsed ? parsed.errors : [])], warnings = [...(parsed ? parsed.warnings : [])];
  if (!String(song.title || "").trim()) errors.unshift({ field: "title", msg: "ใส่ชื่อเพลง" });
  if (song.bpm != null && !validBpm(song.bpm)) errors.push({ field: "bpm", msg: "BPM ต้องเป็นจำนวนเต็ม 40–220" });
  if (!song.blocks || !song.blocks.length) errors.push({ msg: "ยังไม่มีเนื้อเพลงหรือคอร์ด" });
  const st = songStats(song);
  if (song.blocks && song.blocks.length) {
    if (!st.chords) warnings.push({ msg: "ยังไม่มีคอร์ดเลย" });
    if (!st.lyricLines) warnings.push({ msg: "ยังไม่มีเนื้อร้อง (มีแต่คอร์ด)" });
    if (st.unclear) warnings.push({ msg: `มี ${st.unclear} จุดที่อ่านไม่ชัด (สีเหลือง) ตรวจกับต้นฉบับแล้วลบเครื่องหมาย ? ออก` });
  }
  const dup = (others || []).find(o => o.id !== song.id && norm(o.title) === norm(song.title) && norm(o.artist) === norm(song.artist));
  if (dup && String(song.title || "").trim()) warnings.push({ msg: `มีเพลง “${dup.title}${dup.artist ? " – " + dup.artist : ""}” ในคลังแล้ว`, dupId: dup.id });
  return { errors, warnings, stats: st };
}
