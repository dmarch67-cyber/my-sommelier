// Supabase Edge Function: "ask anything" about the cellar. The app sends the
// question, the cellar it is showing, and a compact list of the owner's wines;
// Claude answers by calling an exact lookup over that list (cellar.ts) and
// returns a short answer plus the wines to show as cards.
// Signed-in users only (checked with Supabase Auth). The Anthropic key lives in
// the project's Edge Function secrets as ANTHROPIC_API_KEY and never reaches the app.

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import {
  ANSWER_SCHEMA,
  cleanAnswer,
  cleanRows,
  contextText,
  DETAILS_TOOL,
  FIND_TOOL,
  MAX_TOOL_ROUNDS,
  MODEL,
  runTool,
  SYSTEM,
  type AskRow,
  type FoodLine,
} from './cellar.ts';

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

const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

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
  // Reads as the signed-in user, so row-level security applies.
  const db = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: who, error: authError } = await db.auth.getUser(token);
  if (authError || !who?.user) return reply(401, { error: 'Sign in first.' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Send JSON.' });
  }
  const question = text(body.question, 500);
  if (!question) return reply(400, { error: 'Ask a question about your cellar.' });
  const rows: AskRow[] = cleanRows(body.rows);
  const cellars = (Array.isArray(body.cellars) ? body.cellars : [])
    .map((c) => text(c, 80))
    .filter(Boolean)
    .slice(0, 20);
  const lookingAt = text(body.looking_at, 80) || null;
  const palate = text(body.palate, 1000) || undefined;
  const year = typeof body.year === 'number' ? Math.round(body.year) : new Date().getFullYear();

  // Dishes for wine_details, read only when Claude asks for them.
  async function foodFor(ids: unknown): Promise<FoodLine[]> {
    const wanted = new Set((Array.isArray(ids) ? ids : []).filter((i) => typeof i === 'string'));
    const wineIds = [...new Set(rows.filter((r) => wanted.has(r.id)).map((r) => r.wine_id))]
      .filter(Boolean)
      .slice(0, 10);
    if (!wineIds.length) return [];
    const { data } = await db
      .from('wine_food_matches')
      .select('wine_id,dishes')
      .in('wine_id', wineIds);
    return (data ?? []).map((d: { wine_id: string; dishes: unknown }) => ({
      wine_id: d.wine_id,
      dishes: (Array.isArray(d.dishes) ? d.dishes : [])
        .map((x) => (x && typeof x === 'object' ? text((x as { dish?: unknown }).dish, 80) : ''))
        .filter(Boolean),
    }));
  }

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: contextText({ question, cellars, lookingAt, year, palate }) },
  ];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, rounds: 0 };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const lastRound = round === MAX_TOOL_ROUNDS;
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 6000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: ANSWER_SCHEMA },
        },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        // On the last round the tools are switched off, so Claude must answer.
        tools: [FIND_TOOL, DETAILS_TOOL] as unknown as Anthropic.Beta.BetaTool[],
        tool_choice: lastRound ? { type: 'none' } : { type: 'auto' },
        messages,
      });
      usage.rounds += 1;
      usage.input_tokens += response.usage.input_tokens;
      usage.output_tokens += response.usage.output_tokens;
      usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

      if (response.stop_reason === 'refusal') {
        return reply(422, {
          error: 'The sommelier couldn’t answer that one. Try asking another way.',
        });
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const input = block.input as { ids?: unknown } | undefined;
          const food = block.name === 'wine_details' ? await foodFor(input?.ids) : [];
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(runTool(rows, block.name, block.input, food)),
          });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      const textBlock = response.content.find((b) => b.type === 'text');
      let parsed: unknown = null;
      try {
        parsed = textBlock && textBlock.type === 'text' ? JSON.parse(textBlock.text) : null;
      } catch {
        parsed = null;
      }
      const answer = cleanAnswer(parsed, rows);
      if (!answer) return reply(502, { error: 'The sommelier gave an unclear answer. Try again.' });
      console.log('ask-cellar usage', JSON.stringify(usage));
      return reply(200, { ...answer, usage });
    }
    return reply(502, { error: 'That one took too many steps. Try asking more simply.' });
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
    console.error('ask-cellar failed', e);
    return reply(500, { error: 'Something went wrong asking the sommelier.' });
  }
});
