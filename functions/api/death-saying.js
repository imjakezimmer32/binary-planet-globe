/**
 * POST /api/death-saying
 * Body: { "medium": "lava" | "water" }
 * Returns JSON { kicker, quote, note, cta } — short lines only (no paragraphs).
 *
 * Requires Workers AI binding `AI` on the Pages project (Cloudflare dashboard:
 * Workers & Pages → astrabound → Settings → Functions → Workers AI, binding name AI).
 * Without it, the client falls back to bundled static copy.
 */

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

/** @param {unknown} v @param {number} max */
function clampStr(v, max) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** @param {string} text */
function parseJsonFromModel(text) {
  const t = String(text).trim();
  const i0 = t.indexOf('{');
  const i1 = t.lastIndexOf('}');
  if (i0 === -1 || i1 <= i0) return null;
  try {
    return JSON.parse(t.slice(i0, i1 + 1));
  } catch {
    return null;
  }
}

/** Map older API shape (title/lead/detail/aftermath) into short fields when needed. */
function coerceLegacyShape(o) {
  const out = { ...o };
  if (typeof out.quote !== 'string' || !out.quote.trim()) {
    const lead = typeof out.lead === 'string' ? out.lead.trim() : '';
    if (lead) {
      const one = lead.split(/(?<=[.!?])\s+/)[0] || lead;
      out.quote = one.slice(0, 200);
    }
  }
  if ((!out.kicker || !String(out.kicker).trim()) && typeof out.title === 'string' && out.title.trim()) {
    out.kicker = out.title.trim().slice(0, 44);
  }
  if ((!out.note || !String(out.note).trim()) && typeof out.aftermath === 'string' && out.aftermath.trim()) {
    const a = out.aftermath.trim();
    out.note = (a.split(/(?<=[.!?])\s+/)[0] || a).slice(0, 120);
  }
  return out;
}

/** @param {Record<string, unknown>} o */
function normalizePayload(o) {
  const c = coerceLegacyShape(o);
  return {
    kicker: clampStr(c.kicker, 44),
    quote: clampStr(c.quote, 165),
    note: clampStr(c.note, 105),
    cta: clampStr(c.cta, 28),
  };
}

/** @param {unknown} result */
function extractModelText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && typeof result.response === 'string') return result.response;
  if (typeof result === 'object' && typeof result.text === 'string') return result.text;
  return '';
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AI) {
    return Response.json(
      { ok: false, error: 'no_ai_binding', hint: 'Add Workers AI binding "AI" to this Pages project.' },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Expected JSON body', { status: 400 });
  }

  const medium = body && body.medium;
  if (medium !== 'lava' && medium !== 'water') {
    return new Response('Body must include medium: "lava" | "water"', { status: 400 });
  }

  const circumstance =
    medium === 'lava'
      ? 'Death was from molten lava / volcanic heat (a very short lethal window). Feel: heat, breath, skin, light—never instructional or jokey.'
      : 'Death was from staying in deep water until breath failed (a longer lethal window). Feel: pressure, cold, air hunger, the surface just out of reach—never instructional or jokey.';

  const system = `You write tiny, devastating death meditations for a science-fantasy game.
Output ONLY one JSON object. No markdown. No code fences. Keys EXACTLY: kicker, quote, note, cta — no other keys.

STRICT BREVITY (this matters):
- kicker: 2–7 words, MAX 40 characters. A spare fragment or label—not a sentence, not a paragraph.
- quote: EXACTLY ONE sentence only (one period max). MAX 140 characters. Must read like a heart-breaking, wise line someone would remember—intimate, somatic, second person when it fits. NOT a story. NOT two sentences.
- note: EXACTLY ONE short sentence, MAX 96 characters. A different thought from quote: the quiet "why" that lands after—wise, gentle, crushing. NOT a paragraph.
- cta: 2–5 words, MAX 24 characters. Soft action (e.g. "Step onto shore"). Never say "respawn", "HP", "click".

Never use line breaks inside strings. Never pad with filler. Vary wording every reply.
Avoid: gore for spectacle, slurs, sexual content, real-world tragedy, moralizing.
${circumstance}`;

  const user = `Medium is "${medium}". Write one fresh set of lines now—short enough to fit on a small phone screen.`;

  let rawText = '';
  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 220,
    });
    rawText = extractModelText(result);
  } catch (err) {
    return Response.json(
      { ok: false, error: 'ai_run_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  const parsed = parseJsonFromModel(rawText);
  if (!parsed || typeof parsed !== 'object') {
    return Response.json({ ok: false, error: 'bad_json', raw: rawText.slice(0, 400) }, { status: 502 });
  }

  const out = normalizePayload(/** @type {Record<string, unknown>} */ (parsed));
  if (!out.quote || out.quote.length < 10) {
    return Response.json({ ok: false, error: 'incomplete', partial: out }, { status: 502 });
  }

  return Response.json({ ok: true, ...out }, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
