/**
 * POST /api/death-saying
 * Body: { "medium": "lava" | "water" }
 * Returns JSON { title, lead, detail, aftermath, cta } for the walk respawn UI.
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

/** @param {Record<string, unknown>} o */
function normalizePayload(o) {
  return {
    title: clampStr(o.title, 90),
    lead: clampStr(o.lead, 420),
    detail: clampStr(o.detail, 480),
    aftermath: clampStr(o.aftermath, 260),
    cta: clampStr(o.cta, 44),
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
      ? 'The player died from deadly contact with molten lava / volcanic heat (a very short lethal window in-game). Emphasize heat, breath, skin, weight, light, sound—never instructional or jokey.'
      : 'The player died from staying submerged in deep water until breath failed (a longer lethal window in-game). Emphasize pressure, cold, muffled sound, lungs, limbs heavy, the surface just out of reach—never instructional or jokey.';

  const system = `You write short visceral second-person prose for a science-fantasy videogame "you died" screen.
Output ONLY one JSON object. No markdown. No code fences. No keys other than these five.
Schema: {"title": string, "lead": string, "detail": string, "aftermath": string, "cta": string}
Lengths: title <= 72 chars; lead 160–340 chars; detail 160–400 chars; aftermath 90–220 chars; cta <= 36 chars (short button label).
Tone: somatic, embodied, poetic but readable; second person "you"; vary metaphor, rhythm, and imagery every time—never reuse the same opening clause as a prior reply.
Avoid: gore for its own sake, slurs, sexual content, real-world tragedy, moralizing, game UI jargon ("respawn", "HP").
${circumstance}`;

  const user = `Medium is "${medium}". Write one fresh death screen now. Make it feel unique and circumstantial.`;

  let rawText = '';
  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 720,
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
  if (!out.title || !out.lead) {
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
