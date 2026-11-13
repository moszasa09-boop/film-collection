// Supabase Edge Function: read a chord sheet from pictures with Claude.
//
// Called by the web app (supabase.functions.invoke("read-chords")) with the signed-in member's token.
// Only owners and editors of the band may use it, at most 40 pictures per person per hour. The prompt
// lives here, not in the browser, so the function cannot be used as a general-purpose Claude proxy.
// Needs the secret ANTHROPIC_API_KEY (Supabase dashboard → Edge Functions → Secrets).
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const MODEL = "claude-opus-5-5";
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function prompt(n: number, tiled: boolean): string {
  return `You are transcribing a guitar chord sheet for a Thai band's stage app.
The ${n} attached image(s) are in order and together form ONE song.${tiled ? " Some images are overlapping slices of one photo (top to bottom, or left to right): never write an overlapping line twice." : ""}
If the sheet is printed in several columns, read column 1 top to bottom, then column 2, and so on.

Reply with ONLY this JSON object:
{"title": string|null, "artist": string|null, "bpm": integer|null, "text": string, "unclear": [{"line": integer, "what": string}], "notes": string}

"text" uses this format, one printed line per text line:
- Lyric line: put each chord in square brackets IMMEDIATELY BEFORE the syllable printed directly under that chord, e.g. [Em]สุดท้าย.. ต่อให้เหนี่ยว [Am]รั้งสักเท่าไหร่
- A chord with no lyric under it goes at the end of the line, or on its own line like: [C] [G]
- Boxes of bars (INTRO, INSTRU, OUTRO, SOLO): [INTRO] | Em | Em | C | C | ( 2 Times )  (keep repeat notes; a second row of the same box starts with | )
- A blank line between stanzas, as printed.
- A section name only when one is printed (Verse, Hook, ...): ## Hook
- Printed notes such as ( ซ้ำ * ) or ( Till End ): > ( ซ้ำ * )
- Keep *, ** markers, "..", parentheses and spelling exactly as printed. Copy every Thai vowel and tone mark exactly. Some Thai fonts draw คำ so it looks like ศำ: write the real word.
- Chord spelling exactly as printed (#, b, m, 7, maj7, sus4, slash chords like D/F#).

Honesty rules, which matter more than completeness:
- A chord you cannot read with confidence gets a question mark: [Am?]. A word you cannot read with confidence is wrapped: {?คำ}. A line you cannot read at all: {?อ่านไม่ออก}.
- List every such spot in "unclear" with its 1-based line number in "text" and what is uncertain.
- Never invent lyrics or chords that are not in the images, and do not "fix" the music.
- If an image is not a chord sheet, return "text": "" and say so in "notes".
- "bpm" only if a tempo is printed; otherwise null. "title"/"artist" only if printed; otherwise null.`;
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { code: "invalid_request", message: "POST only" });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply(503, { code: "not_configured", message: "ANTHROPIC_API_KEY is not set for this project" });

  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return reply(401, { code: "not_signed_in", message: "sign in first" });

  let body: { bandId?: string; images?: { media_type: string; data: string }[]; tiled?: boolean };
  try { body = await req.json(); } catch { return reply(400, { code: "invalid_request", message: "body must be JSON" }); }
  const images = Array.isArray(body.images) ? body.images : [];
  if (!body.bandId || !images.length) return reply(400, { code: "invalid_request", message: "bandId and images are required" });
  if (images.length > MAX_IMAGES) return reply(400, { code: "image_rejected", message: `at most ${MAX_IMAGES} pictures` });
  for (const im of images) {
    if (!MEDIA.has(im.media_type) || typeof im.data !== "string" || im.data.length * 0.75 > MAX_IMAGE_BYTES) {
      return reply(400, { code: "image_rejected", message: "pictures must be JPEG, PNG, WebP or GIF under 5 MB" });
    }
  }

  const { data: role } = await supabase.rpc("band_role", { p_band: body.bandId });
  if (role !== "owner" && role !== "editor") return reply(403, { code: "not_granted", message: "only owners and editors can read pictures" });
  const { data: left } = await supabase.rpc("ocr_allowance");
  if (typeof left === "number" && left < images.length) return reply(429, { code: "rate_limited", message: "picture allowance for this hour is used up" });
  const { error: logError } = await supabase.from("ocr_log").insert({ band_id: body.bandId, images: images.length });
  if (logError) return reply(403, { code: "not_granted", message: logError.message });

  const client = new Anthropic({ apiKey });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      messages: [{
        role: "user",
        content: [
          ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.media_type as "image/jpeg", data: im.data } })),
          { type: "text" as const, text: prompt(images.length, !!body.tiled) },
        ],
      }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") return reply(422, { code: "refused", message: "Claude declined these pictures" });
    const text = message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const parsed = parseJson(text) as Record<string, unknown> | null;
    if (!parsed || typeof parsed.text !== "string") return reply(502, { code: "invalid_json", message: "the reply could not be read", raw: text.slice(0, 2000) });
    if (message.stop_reason === "max_tokens") parsed.notes = `${parsed.notes ?? ""} (cut short: the sheet was too long, check the end)`.trim();
    return reply(200, parsed);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply(429, { code: "rate_limited", message: "Claude is busy or the account limit was reached" });
    if (e instanceof Anthropic.AuthenticationError) return reply(503, { code: "not_configured", message: "ANTHROPIC_API_KEY is not valid" });
    if (e instanceof Anthropic.BadRequestError) return reply(400, { code: "image_rejected", message: e.message });
    if (e instanceof Anthropic.APIError) return reply(502, { code: "upstream_error", message: `Claude API error ${e.status}` });
    return reply(502, { code: "upstream_error", message: String(e) });
  }
});
