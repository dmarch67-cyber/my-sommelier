// Supabase Edge Function: fills in wine facts with Claude (enrichment stage 1).
//
// Each call takes the next few wines the fill-in has not looked at yet, asks
// Claude for colour, body, producer, grapes and a starting drinking window per
// vintage, and saves them through apply_wine_enrichment(), which only fills
// blanks. The app calls it quietly in the background until nothing is left.
//
// Only signed-in users can call it, and it reads and writes as that user, so
// row-level security keeps every account's wines separate. The Anthropic key
// lives in the project's Edge Function secrets as ANTHROPIC_API_KEY.

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import {
  BATCH_SIZE,
  cleanFill,
  FILL_SCHEMA,
  MODEL,
  SYSTEM,
  userText,
  type WineToFill,
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

  const { data: wines, error: readError } = await db
    .from('wines')
    .select('id,name,producer,country,region,appellation,vintages(id,year)')
    .is('enriched_at', null)
    .order('created_at')
    .order('id')
    .limit(BATCH_SIZE);
  if (readError) {
    console.error('read wines failed', readError.message);
    return reply(500, { error: 'Could not read the cellar.' });
  }
  if (!wines || wines.length === 0) return reply(200, { enriched: 0, windows: 0, remaining: 0 });

  const asked = wines as WineToFill[];
  const year = new Date().getFullYear();
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
        format: { type: 'json_schema', schema: FILL_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: 'user', content: userText(asked, year) }],
    });
    usage = response.usage;
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      console.error('fill-in stopped early', response.stop_reason);
      return reply(502, { error: 'The fill-in gave no usable answer.', code: 'no_answer' });
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    let parsed: unknown = null;
    try {
      parsed = textBlock && textBlock.type === 'text' ? JSON.parse(textBlock.text) : null;
    } catch {
      parsed = null;
    }
    if (!parsed)
      return reply(502, { error: 'The fill-in gave no usable answer.', code: 'no_answer' });

    const fills = cleanFill(parsed, asked, year);
    const { data: applied, error: writeError } = await db.rpc('apply_wine_enrichment', {
      p_items: fills,
      p_source: 'claude',
    });
    if (writeError) {
      console.error('apply failed', writeError.message);
      return reply(500, { error: 'Could not save the fill-in.' });
    }

    const { count } = await db
      .from('wines')
      .select('id', { count: 'exact', head: true })
      .is('enriched_at', null);
    return reply(200, {
      enriched: (applied as { wines?: number })?.wines ?? 0,
      windows: (applied as { windows?: number })?.windows ?? 0,
      remaining: count ?? 0,
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
    console.error('enrich-wines failed', e, usage);
    return reply(500, { error: 'Something went wrong filling in wines.' });
  }
});
