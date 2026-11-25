// Supabase Edge Function: "What critics and drinkers say" on the Wine page.
//
// The drinking-window review (assess-wines) already summarised recent critic
// and community notes for each vintage, but wrote it to explain the window.
// This rewrites those summaries for the reader with Claude Haiku (no new web
// search, so it costs a fraction of a cent per wine) and picks a link to the
// full notes on CellarTracker. It also redoes any vintage whose review changed
// since its last rewrite, so it can simply be run again after a refresh.
//
// Called from the database (pg_net) with the shared secret 'assess_secret'
// from Supabase Vault in the x-assess-secret header, like assess-wines.
//   body: { wine_ids?: string[], limit?: number, account_id?: string }

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import {
  cleanAnswer,
  MODEL,
  notesUrl,
  SCHEMA,
  type Source,
  SYSTEM,
  userText,
  type VintageIn,
  type WineIn,
} from './prompt.ts';

const DEFAULT_ACCOUNT = 'b7a2bb88-b2c5-41f4-862c-17d95cd24b01';

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!apiKey || !supabaseUrl || !serviceKey) return reply(503, { error: 'Not set up.' });

  let body: { wine_ids?: string[]; limit?: number; account_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: allowed } = await db.rpc('assess_secret_ok', {
    p_secret: req.headers.get('x-assess-secret') ?? '',
  });
  if (allowed !== true) return reply(401, { error: 'Not allowed.' });

  const accountId = body.account_id ?? DEFAULT_ACCOUNT;
  let wineIds = Array.isArray(body.wine_ids) ? body.wine_ids.slice(0, 20) : null;
  if (!wineIds) {
    const limit = Number.isInteger(body.limit) ? Math.min(body.limit as number, 20) : 5;
    wineIds = await winesDue(db, accountId, limit);
  }
  if (wineIds.length === 0) return reply(200, { done: true });

  const client = new Anthropic({ apiKey });
  const results = await Promise.all(
    wineIds.map((id) =>
      rewriteWine(db, client, id).catch((e) => ({ wine_id: id, error: String(e).slice(0, 300) })),
    ),
  );
  return reply(200, { results });
});

/** Wines with a vintage whose summary has not been rewritten since its last review. */
// deno-lint-ignore no-explicit-any
async function winesDue(db: any, accountId: string, limit: number): Promise<string[]> {
  const { data } = await db
    .from('vintage_assessments')
    .select('assessed_at,critics_said_at,vintages(wine_id)')
    .eq('account_id', accountId)
    .not('summary', 'is', null)
    .limit(5000);
  const due = new Set<string>();
  for (const r of data ?? []) {
    const stale = !r.critics_said_at || r.critics_said_at < r.assessed_at;
    if (stale && r.vintages?.wine_id) due.add(r.vintages.wine_id);
    if (due.size >= limit) break;
  }
  return [...due];
}

// deno-lint-ignore no-explicit-any
async function rewriteWine(db: any, client: Anthropic, wineId: string) {
  const { data: w, error } = await db
    .from('wines')
    .select(
      'id,name,producer,country,region,appellation,' +
        'vintages(id,year,cellartracker_id,scores(source,source_detail,raw_value),' +
        'critic_notes(author,kind,score,noted_on,note),' +
        'vintage_assessments(summary,maturity,recent_notes,latest_note_year,' +
        'wine_assessments(sources)))',
    )
    .eq('id', wineId)
    .single();
  if (error || !w) throw new Error(error?.message ?? 'wine not found');

  const sources: Source[] = [];
  const vintages: VintageIn[] = [];
  const years = new Map<string, number | null>();
  const ctIds = new Map<string, string | null>();
  // deno-lint-ignore no-explicit-any
  for (const v of (w.vintages ?? []) as any[]) {
    const va = Array.isArray(v.vintage_assessments)
      ? v.vintage_assessments[0]
      : v.vintage_assessments;
    if (!va?.summary) continue;
    for (const s of va.wine_assessments?.sources ?? []) {
      if (s && typeof s.url === 'string')
        sources.push({ url: s.url, title: String(s.title ?? '') });
    }
    years.set(v.id, v.year);
    ctIds.set(v.id, v.cellartracker_id ?? null);
    vintages.push({
      vintage_id: v.id,
      year: v.year,
      maturity: va.maturity,
      recent_notes: va.recent_notes ?? 0,
      latest_note_year: va.latest_note_year,
      summary: va.summary,
      scores: (v.scores ?? []).filter((s: { source: string }) => !/vivino/i.test(s.source)),
      notes: v.critic_notes ?? [],
    });
  }
  if (vintages.length === 0) return { wine_id: wineId, saved: 0 };

  const wine: WineIn = {
    name: w.name,
    producer: w.producer,
    place: [w.appellation, w.region, w.country].filter(Boolean).join(', '),
    vintages,
  };
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: userText(wine) }],
  });
  const block = message.content.find((b) => b.type === 'text');
  if (message.stop_reason !== 'end_turn' || !block || block.type !== 'text') {
    throw new Error(`stopped: ${message.stop_reason}`);
  }
  const items = cleanAnswer(JSON.parse(block.text), wine).map((i) => ({
    ...i,
    url: notesUrl(w.name, years.get(i.vintage_id) ?? null, sources, ctIds.get(i.vintage_id)),
  }));
  const { data: saved, error: saveError } = await db.rpc('save_critics_say', { p_items: items });
  if (saveError) throw new Error(saveError.message);
  return {
    wine_id: wineId,
    saved,
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  };
}
