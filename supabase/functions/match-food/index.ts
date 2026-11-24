// Supabase Edge Function: writes the "Food matches" for the Wine page.
//
// Each call takes the next few wines that have no dishes yet (or the one wine
// named in { wine_id }), asks Claude for 4 to 6 dishes per wine with a short
// reason, one thing to avoid and what suits it once mature, and saves them in
// wine_food_matches. One list per wine, not per vintage. No web search, so a
// whole cellar costs a few dollars once; new wines cost pennies.
//
// Only signed-in users can call it, and it reads and writes as that user, so
// row-level security keeps every account's wines separate. The Anthropic key
// lives in the project's Edge Function secrets as ANTHROPIC_API_KEY.

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import {
  BATCH_SIZE,
  cleanMatches,
  MATCH_SCHEMA,
  MODEL,
  SYSTEM,
  userText,
  type WineToMatch,
} from './prompt.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return reply(503, { error: 'ANTHROPIC_API_KEY is missing.', code: 'no_key' });

  // Signed-in users only; every query below runs as that user.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!token || !supabaseUrl || !anonKey) return reply(401, { error: 'Sign in first.' });
  const db = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: who, error: authError } = await db.auth.getUser(token);
  if (authError || !who?.user) return reply(401, { error: 'Sign in first.' });

  let wineId: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.wine_id === 'string' && UUID.test(body.wine_id)) wineId = body.wine_id;
  } catch {
    // No body: take the next batch.
  }

  const { data: rows, error: readError } = await db.rpc('wines_needing_food_matches', {
    p_limit: wineId ? 1 : BATCH_SIZE,
    p_wine_id: wineId,
  });
  if (readError) {
    console.error('read wines failed', readError.message);
    return reply(500, { error: 'Could not read the cellar.' });
  }
  const asked = (rows ?? []) as (WineToMatch & { remaining: number })[];
  if (asked.length === 0) return reply(200, { matched: 0, remaining: 0 });
  const remainingBefore = Number(asked[0].remaining) || asked.length;

  const client = new Anthropic({ apiKey });
  let usage: unknown = null;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: MATCH_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: 'user', content: userText(asked) }],
    });
    usage = response.usage;
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      console.error('food match stopped early', response.stop_reason);
      return reply(502, { error: 'No usable answer.', code: 'no_answer' });
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    let parsed: unknown = null;
    try {
      parsed = textBlock && textBlock.type === 'text' ? JSON.parse(textBlock.text) : null;
    } catch {
      parsed = null;
    }
    const matches = cleanMatches(parsed, asked);
    if (matches.length === 0) return reply(502, { error: 'No usable answer.', code: 'no_answer' });

    const model = (response as { model?: string }).model ?? MODEL;
    const { error: writeError } = await db.from('wine_food_matches').upsert(
      matches.map((m) => ({ ...m, model, made_at: new Date().toISOString() })),
      { onConflict: 'wine_id' },
    );
    if (writeError) {
      console.error('save failed', writeError.message);
      return reply(500, { error: 'Could not save the dishes.' });
    }

    return reply(200, {
      matched: matches.length,
      remaining: wineId ? 0 : Math.max(0, remainingBefore - matches.length),
      matches: wineId ? matches : undefined,
      usage,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return reply(503, { error: 'The Anthropic key was refused.', code: 'bad_key' });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return reply(429, { error: 'Busy. Try again shortly.', code: 'busy' });
    }
    if (e instanceof Anthropic.APIError) {
      const credit = /credit|billing/i.test(e.message);
      console.error('anthropic error', e.status, e.message);
      return reply(502, {
        error: credit ? 'Out of Anthropic credit.' : 'Claude is unavailable right now.',
        code: credit ? 'no_credit' : 'unavailable',
      });
    }
    console.error('match-food failed', e, usage);
    return reply(500, { error: 'Something went wrong finding dishes.' });
  }
});
