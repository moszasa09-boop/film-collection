/* ---------- chords ---------- */
const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const IDX = { C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, F: 5, "E#": 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11 };
/** One chord symbol, optionally in parentheses, optionally ending in "?" (= read unclearly). */
const CHORD_RE = /^\(?[A-G](#|b)?(m(?!aj)|min|dim|aug|\+|°|ø)?(maj|M)?\d{0,2}(maj\d{0,2}|M\d{0,2}|add\d{1,2}|sus\d?|[b#]\d{1,2}|no\d|dim\d?|aug)*(\/[A-G](#|b)?)?\)?\??$/;
const isChord = tok => CHORD_RE.test(tok || "");
const isUnclearChord = tok => /\?$/.test(tok || "");

/** Shift every note name in a chord symbol (root and slash bass) by s semitones. */
function tr(ch, s) {
  if (!s || !ch) return ch;
  return ch.replace(/(^|[\/(\s|])([A-G](?:#|b)?)/g, (m, pre, root) => IDX[root] == null ? m : pre + NOTES[(((IDX[root] + s) % 12) + 12) % 12]);
}
function firstChord(blocks) {
  for (const b of blocks || []) {
    if (b.type === "instru" && b.bars && b.bars.length) return b.bars[0].split(/\s+/)[0];
    if (b.type === "lines") for (const l of b.lines) for (const [c] of l) if (c) return c;
  }
  return "";
}
function keyOf(blocks, s) {
  const m = /^\(?([A-G](?:#|b)?)(m(?!aj))?/.exec(firstChord(blocks) || "");
  return m ? tr(m[1], s || 0) + (m[2] ? "m" : "") : "";
}

/* ---------- sections & timing ----------
   Each playable row gets a length in bars (4/4):
   - lyric line: 2 bars, or half its chord count when it has more than 4 chords
   - chord-only line: one bar per chord
   - INTRO / INSTRU box: its bars, times the "( n Times )" note
   Section names: an explicit "## name" wins; a stanza starting with "**" is the hook (and "*" is then
   the pre-hook); if the song only uses "*", that is the hook; other stanzas are verses.
   "( ซ้ำ * , ** )" writes the repeated stanzas out again so the timeline follows the real song. */
const HEADER_RE = /^(verse|hook|chorus|bridge|pre|ending|outro|intro|key|solo|ท่อน|ฮุค|เวิร์ส|พรีฮุค|บริดจ์)/i;
function stanzaMark(b) {
  const t = (b.lines[0] || []).map(s => s[1] || "").join("").trim();
  return t.startsWith("**") ? 2 : t.startsWith("*") ? 1 : 0;
}
function analyse(src) {
  const blocks = [];
  (src || []).forEach(b => {
    if (b.type === "note" && /ซ้ำ/.test(b.text) && /\*/.test(b.text)) {
      const marks = (b.text.match(/\*+/g) || []).map(m => m.length);
      const copies = marks.map(n => blocks.find(x => x.type === "lines" && stanzaMark(x) === n)).filter(Boolean);
      if (copies.length === marks.length) { copies.forEach(c => blocks.push({ ...c, repeat: true })); return; }
    }
    blocks.push(b);
  });
  const usesDouble = blocks.some(b => b.type === "lines" && stanzaMark(b) === 2);
  const lastInstru = blocks.map(b => b.type).lastIndexOf("instru");
  const firstLines = blocks.findIndex(b => b.type === "lines");
  const out = [];
  let pendingHeader = null, prevInstruName = null;
  blocks.forEach((b, i) => {
    if (b.type === "note" && HEADER_RE.test(b.text.trim()) && !/ซ้ำ/.test(b.text)) { pendingHeader = b.text.trim(); return; }
    if (b.type === "instru") {
      let name;
      if (!b.label && prevInstruName) name = prevInstruName;
      else if ((firstLines < 0 ? false : i < firstLines) || /intro|อินโทร/i.test(b.label || "")) name = "อินโทร";
      else if (i === lastInstru && blocks.slice(i + 1).every(x => x.type !== "lines")) name = "เอาท์โทร";
      else name = "ดนตรี";
      if (pendingHeader) { name = pendingHeader; pendingHeader = null; }
      prevInstruName = name;
      const m = /(\d+)\s*(times|ครั้ง|รอบ)|x\s*(\d+)/i.exec(b.note || "");
      const times = m ? +(m[1] || m[3]) : 1;
      out.push({ kind: "instru", block: b, name, bars: Math.max(2, (b.bars || []).length * Math.min(times, 32)) });
      return;
    }
    prevInstruName = null;
    if (b.type === "lines") {
      const st = stanzaMark(b);
      let name = b.section || (st === 2 ? "ฮุค" : st === 1 ? (usesDouble ? "พรีฮุค" : "ฮุค") : "เวิร์ส");
      if (pendingHeader) { name = pendingHeader; pendingHeader = null; }
      out.push({ kind: "lines", block: b, name, lines: b.lines.map(l => {
        const n = l.filter(([c]) => c).length;
        const hasText = l.some(([, t]) => t && t.trim());
        return { line: l, bars: !hasText ? Math.max(1, n) : n > 4 ? Math.ceil(n / 2) : 2 };
      }) });
      return;
    }
    out.push({ kind: b.type, block: b, name: null, bars: 0 });
  });
  let v = 0;
  out.forEach(o => { if (o.kind === "lines" && o.name === "เวิร์ส" && !o.block.section) o.name = "เวิร์ส " + (++v); });
  out.forEach(o => { if (o.block.repeat) o.name += " (ซ้ำ)"; });
  return out;
}
function songBars(blocks) {
  return analyse(blocks).reduce((n, p) => n + (p.kind === "lines" ? p.lines.reduce((m, l) => m + l.bars, 0) : p.bars), 0);
}
const validBpm = v => Number.isInteger(v) && v >= 40 && v <= 220;
const songSeconds = (blocks, bpm) => songBars(blocks) * 4 * 60 / (validBpm(bpm) ? bpm : 80);

/** What a song has, for readiness badges. Lyrics count in any script (Thai, English, ...). */
function songStats(song) {
  let chords = 0, lyricLines = 0, unclear = 0;
  for (const b of (song && song.blocks) || []) {
    if (b.type === "instru") for (const bar of b.bars || []) for (const c of bar.split(/\s+/)) { if (c) { chords++; if (isUnclearChord(c)) unclear++; } }
    if (b.type === "lines") for (const l of b.lines) {
      let text = "";
      for (const [c, t] of l) { if (c) { chords++; if (isUnclearChord(c)) unclear++; } text += t || ""; }
      unclear += (text.match(/\{\?/g) || []).length;
      if (/[\p{L}]/u.test(text.replace(/\{\?|\}/g, ""))) lyricLines++;
    }
  }
  return { chords, lyricLines, unclear, ready: chords > 0 && lyricLines > 0 && unclear === 0 };
}
