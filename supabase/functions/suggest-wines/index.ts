// Supabase Edge Function: the Tonight sommelier. The app sends what Dan typed or
// said ("lamb chops, something special") and a short list of his bottles that
// are ready to drink; Claude picks the best few and says why in one line each.
// Signed-in users only (checked with Supabase Auth). The Anthropic key lives in
// the project's Edge Function secrets as ANTHROPIC_API_KEY and never reaches the app.

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import {
  cleanCandidate,
  cleanSuggestion,
  MAX_CANDIDATES,
  MODEL,
  SUGGESTION_SCHEMA,
  SYSTEM,
  userText,
  type Candidate,
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
  if (!apiKey) return reply(503, { error: 'The sommelier isn’t set up yet.', code: 'no_key' });

  // Signed-in users only.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!token || !supabaseUrl || !anonKey) return reply(401, { error: 'Sign in first.' });
  const { data: who, error: authError } = await createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.getUser(token);
  if (authError || !who?.user) return reply(401, { error: 'Sign in first.' });

  let body: { ask?: unknown; candidates?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Send JSON.' });
  }
  const ask = typeof body.ask === 'string' ? body.ask.trim().slice(0, 500) : '';
  const candidates: Candidate[] = (Array.isArray(body.candidates) ? body.candidates : [])
    .map(cleanCandidate)
    .filter((c): c is Candidate => c !== null)
    .slice(0, MAX_CANDIDATES);
  if (!ask) return reply(400, { error: 'Say what you’re eating or in the mood for.' });
  if (candidates.length === 0) return reply(200, { picks: [], note: null });

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SUGGESTION_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: 'user', content: userText(ask, candidates) }],
    });

    if (response.stop_reason === 'refusal') {
      return reply(422, {
        error: 'The sommelier couldn’t answer that one. Try asking another way.',
      });
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    let parsed: unknown = null;
    try {
      parsed = textBlock && textBlock.type === 'text' ? JSON.parse(textBlock.text) : null;
    } catch {
      parsed = null;
    }
    const suggestion = cleanSuggestion(parsed, candidates);
    if (!suggestion)
      return reply(502, { error: 'The sommelier gave an unclear answer. Try again.' });
    return reply(200, { ...suggestion, usage: response.usage });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return reply(503, { error: 'The sommelier’s key was refused.', code: 'bad_key' });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return reply(429, { error: 'Too many asks at once. Wait a moment and try again.' });
    }
    if (e instanceof Anthropic.APIError) {
      const msg = /credit|billing/i.test(e.message)
        ? 'The sommelier is out of credit. Add credit at platform.claude.com.'
        : 'The sommelier is unavailable right now. Try again shortly.';
      console.error('anthropic error', e.status, e.message);
      return reply(502, { error: msg });
    }
    console.error('suggest-wines failed', e);
    return reply(500, { error: 'Something went wrong asking the sommelier.' });
  }
});
