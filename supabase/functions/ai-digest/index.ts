import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { MAX_BODY_CHARS, buildPrompt, describeModelAnswer, extractModelText, parseLang, parseModelTextDetailed, sanitizePayload } from './logic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const DEFAULT_MODEL = 'gemini-3.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 25_000;
const MIN_INTERVAL_MS = 15_000;

// Best-effort throttle per administrator; instances are short-lived, so this only stops a tight loop.
const lastCall = new Map<string, number>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: authData, error: authError } = await caller.auth.getUser();
    if (authError || !authData.user) return json({ error: 'auth_required' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: me, error: profileError } = await admin
      .from('profiles')
      .select('id,role,active')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError) { console.error('profile lookup failed:', profileError.message); return json({ error: 'db_error' }, 500); }
    if (!me || me.role !== 'admin' || !me.active) return json({ error: 'forbidden' }, 403);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'ai_not_configured' }, 500);
    const model = (Deno.env.get('AI_MODEL') ?? '').trim() || DEFAULT_MODEL;

    const now = Date.now();
    const prev = lastCall.get(me.id) ?? 0;
    if (now - prev < MIN_INTERVAL_MS) return json({ error: 'ai_rate_limited' }, 429);
    lastCall.set(me.id, now);

    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return json({ error: 'payload_too_large' }, 413);
    let body: { payload?: unknown; lang?: unknown };
    try { body = JSON.parse(text); } catch { return json({ error: 'bad_request' }, 400); }
    const payload = sanitizePayload(body.payload);
    if (!payload) return json({ error: 'bad_request' }, 400);
    const lang = parseLang(body.lang);

    const { system, user } = buildPrompt(payload, lang);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      console.error('gemini request failed:', e instanceof Error ? e.name : 'error');
      return json({ error: 'ai_unavailable' }, 502);
    } finally {
      clearTimeout(timer);
    }

    // Neither the key, the payload nor the model answer is logged.
    if (res.status === 429) return json({ error: 'ai_rate_limited' }, 429);
    if (!res.ok) { console.error('gemini status:', res.status); return json({ error: 'ai_unavailable' }, 502); }

    const answer = await res.json();
    const parsed = parseModelTextDetailed(extractModelText(answer));
    if (!parsed.ok) {
      // Fixed codes and counts only: no key, no data, no text of the answer.
      const diagnostics = { reason: parsed.reason, ...describeModelAnswer(answer) };
      console.error('ai bad response:', JSON.stringify(diagnostics));
      return json({ error: 'ai_bad_response', ...diagnostics }, 502);
    }
    return json({ headline: parsed.value.headline, bullets: parsed.value.bullets, model, generated_at: new Date().toISOString() });
  } catch (e) {
    console.error('ai-digest failed:', e instanceof Error ? e.message : 'error');
    return json({ error: 'ai_unavailable' }, 500);
  }
});
