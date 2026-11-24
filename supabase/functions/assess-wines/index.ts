// Supabase Edge Function: blended drinking windows (enrichment stage 3).
//
// Each call reviews ONE wine: it claims the next wine (most bottles first),
// gathers what the app knows (CellarTracker window, critic scores, the
// owner's own notes), lets Claude search the web for recent tasting notes,
// and saves one blended window per vintage through apply_assessment().
//
// It is called by a database schedule (pg_cron + pg_net), not by the app, so
// reviews carry on with the app closed. The schedule sends the shared secret
// 'assess_secret' from Supabase Vault in the x-assess-secret header; the
// function checks it with assess_secret_ok() and then works with the service
// role. The Anthropic key is the ANTHROPIC_API_KEY Edge Function secret.

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import {
  cleanAssessment,
  MODEL,
  RECORD_TOOL,
  systemPrompt,
  userText,
  type WineIn,
} from './prompt.ts';

const DEFAULT_ACCOUNT = 'b7a2bb88-b2c5-41f4-862c-17d95cd24b01';
const MAX_ROUNDS = 6;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Usage = { input: number; output: number; searches: number };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!apiKey || !supabaseUrl || !serviceKey) return reply(503, { error: 'Not set up.' });

  let body: { account_id?: string; max?: number } = {};
  try {
    body = await req.json();
  } catch {
    // no body
  }
  const accountId = body.account_id ?? DEFAULT_ACCOUNT;
  const max = Number.isInteger(body.max) ? (body.max as number) : 50;

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: allowed } = await db.rpc('assess_secret_ok', {
    p_secret: req.headers.get('x-assess-secret') ?? '',
  });
  if (allowed !== true) return reply(401, { error: 'Not allowed.' });

  const { data: assessmentId, error: claimError } = await db.rpc('claim_next_assessment', {
    p_account_id: accountId,
    p_max: max,
  });
  if (claimError) return reply(500, { error: claimError.message });
  if (!assessmentId) return reply(200, { done: true });

  const usage: Usage = { input: 0, output: 0, searches: 0 };
  const fail = async (msg: string) => {
    await db.rpc('fail_assessment', {
      p_assessment_id: assessmentId,
      p_error: msg,
      p_usage: usage,
    });
    return reply(502, { error: msg });
  };

  try {
    const wine = await loadWine(db, assessmentId as string);
    if (!wine || wine.vintages.length === 0) return await fail('nothing to review');

    const year = new Date().getFullYear();
    const client = new Anthropic({ apiKey });
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userText(wine) }];
    let recorded: unknown = null;
    let nudged = false;
    for (let round = 0; round < MAX_ROUNDS && !recorded; round++) {
      const message = await client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: 32000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          system: systemPrompt(year),
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
            RECORD_TOOL as unknown as Anthropic.Beta.BetaTool,
          ],
          tool_choice: { type: 'auto' },
          messages,
        })
        .finalMessage();
      usage.input += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
      usage.output += message.usage.output_tokens;
      usage.searches += message.usage.server_tool_use?.web_search_requests ?? 0;

      const call = message.content.find(
        (b) => b.type === 'tool_use' && b.name === RECORD_TOOL.name,
      );
      if (call && call.type === 'tool_use') {
        recorded = call.input;
        break;
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.stop_reason === 'end_turn' && !nudged) {
        nudged = true;
        messages.push({ role: 'assistant', content: message.content });
        messages.push({
          role: 'user',
          content: 'Please call record_assessment now with every vintage listed.',
        });
        continue;
      }
      return await fail(`stopped: ${message.stop_reason}`);
    }
    if (!recorded) return await fail('no assessment recorded');

    const clean = cleanAssessment(recorded, wine, year);
    const { data: applied, error: applyError } = await db.rpc('apply_assessment', {
      p_assessment_id: assessmentId,
      p_vintages: clean.vintages,
      p_sources: clean.sources,
      p_usage: usage,
      p_model: MODEL,
    });
    if (applyError) return await fail(`save failed: ${applyError.message}`);
    return reply(200, { wine: wine.name, applied, usage });
  } catch (e) {
    const credit = e instanceof Anthropic.APIError && /credit|billing/i.test(e.message);
    return await fail(credit ? 'out of Anthropic credit' : String(e).slice(0, 300));
  }
});

// deno-lint-ignore no-explicit-any
async function loadWine(db: any, assessmentId: string): Promise<WineIn | null> {
  const { data: a } = await db
    .from('wine_assessments')
    .select('wine_id')
    .eq('id', assessmentId)
    .single();
  if (!a) return null;
  const { data: w } = await db
    .from('wines')
    .select(
      'id,name,producer,country,region,appellation,colour,grapes,' +
        'vintages(id,year,drink_from,drink_to,drink_window_source,' +
        'holdings(quantity,quantity_on_order),' +
        'scores(source,source_detail,raw_value,drink_from,drink_to,reviewed_on),' +
        'tasting_notes(tasted_on,maturity,rating,notes))',
    )
    .eq('id', a.wine_id)
    .single();
  if (!w) return null;
  // deno-lint-ignore no-explicit-any
  const vintages = (w.vintages ?? []).map((v: any) => ({
    id: v.id,
    year: v.year,
    bottles: (v.holdings ?? []).reduce(
      (n: number, h: { quantity: number; quantity_on_order: number }) =>
        n + h.quantity + h.quantity_on_order,
      0,
    ),
    drink_from: v.drink_from,
    drink_to: v.drink_to,
    drink_window_source: v.drink_window_source,
    scores: v.scores ?? [],
    own_notes: v.tasting_notes ?? [],
  }));
  return {
    id: w.id,
    name: w.name,
    producer: w.producer,
    country: w.country,
    region: w.region,
    appellation: w.appellation,
    colour: w.colour,
    grapes: w.grapes ?? [],
    // Only the vintages still in the cellar (or on order) are worth paying for.
    // deno-lint-ignore no-explicit-any
    vintages: vintages.filter((v: any) => v.bottles > 0),
  };
}
