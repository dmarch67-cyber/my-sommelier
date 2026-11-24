// Supabase Edge Function: brings facts about each wine in from the owner's
// CellarTracker account (enrichment stage 2).
//
// Downloads the owner's official CellarTracker export, matches it to the
// app's wines by name and vintage, and saves windows, scores (including
// Vinous, when the owner has linked Vinous in CellarTracker), colour and
// grapes through apply_cellartracker(). Bottle counts are never used.
//
// Runs at most once a day per account unless called with {"force": true}.
// Secrets (set in the Supabase dashboard, never in code or chat):
//   CT_USERNAME, CT_PASSWORD  the owner's CellarTracker login
// The login belongs to one person, so its facts only go into that person's
// account (CT_OWNER_ACCOUNT, or Dan's account by default). Other users will
// need their own CellarTracker connection before this is opened up.

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import { cleanPicks, leftovers, MODEL, PICK_SCHEMA, pickPrompt, SYSTEM } from './claudeMatch.ts';
import {
  exportUrl,
  looksLikeExport,
  matchRows,
  parseCsv,
  rowFacts,
  type AppVintage,
} from './ct.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Dan's account. Not a secret: row-level security still decides who can write to it.
const DEFAULT_OWNER_ACCOUNT = 'b7a2bb88-b2c5-41f4-862c-17d95cd24b01';
// Bump when the matching changes, so the next app start re-runs the sync
// instead of waiting a day.
const MATCHER_VERSION = 4;
const DAY_MS = 20 * 60 * 60 * 1000; // "once a day", with some slack

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const ctUser = Deno.env.get('CT_USERNAME');
  const ctPassword = Deno.env.get('CT_PASSWORD');
  const ownerAccount = (Deno.env.get('CT_OWNER_ACCOUNT') ?? DEFAULT_OWNER_ACCOUNT).trim();
  if (!ctUser || !ctPassword) {
    return reply(200, { skipped: 'not_set_up' });
  }

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

  let force = false;
  try {
    force = (await req.json())?.force === true;
  } catch {
    // no body
  }

  // Only a member who can write to the owner's account may use the login.
  const { data: member } = await db
    .from('account_members')
    .select('account_id,role')
    .eq('user_id', who.user.id)
    .eq('account_id', ownerAccount)
    .in('role', ['owner', 'editor'])
    .maybeSingle();
  if (!member) return reply(200, { skipped: 'not_owner' });
  const accountId = ownerAccount;

  if (!force) {
    const { data: last } = await db
      .from('enrichment_runs')
      .select('started_at,summary')
      .eq('account_id', accountId)
      .eq('source', 'cellartracker')
      .eq('ok', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const sameVersion = (last?.summary as { version?: number } | null)?.version === MATCHER_VERSION;
    if (
      last &&
      sameVersion &&
      Date.now() - new Date(last.started_at as string).getTime() < DAY_MS
    ) {
      return reply(200, { skipped: 'recent' });
    }
  }

  const log = async (ok: boolean, summary: Record<string, unknown>) => {
    await db
      .from('enrichment_runs')
      .insert({ account_id: accountId, source: 'cellartracker', ok, summary });
  };

  // 1. Download the export. CellarTracker sends Windows-1252 text.
  let rows: Record<string, string>[];
  try {
    const res = await fetch(exportUrl(ctUser, ctPassword, 'List'), {
      headers: { 'User-Agent': 'MySommelier/1.0 (personal cellar app)' },
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder('windows-1252').decode(bytes);
    rows = parseCsv(text);
    if (!res.ok || !looksLikeExport(rows)) {
      const hint = /password|log ?in|sign ?in/i.test(text.slice(0, 4000))
        ? 'login_refused'
        : 'unexpected_reply';
      await log(false, { error: hint, http: res.status, start: text.slice(0, 200) });
      return reply(502, { error: 'CellarTracker did not send the export.', code: hint });
    }
  } catch (e) {
    await log(false, { error: 'fetch_failed', detail: String(e).slice(0, 300) });
    return reply(502, { error: 'Could not reach CellarTracker.', code: 'unreachable' });
  }

  // 2. The app's vintages, with their wine names.
  const vintages: AppVintage[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('vintages')
      .select('id,year,wines(name)')
      .order('id')
      .range(from, from + 999);
    if (error) {
      await log(false, { error: 'read_failed', detail: error.message });
      return reply(500, { error: 'Could not read the cellar.' });
    }
    for (const v of data ?? []) {
      const wine = (v as { wines?: { name?: string } | null }).wines;
      if (wine?.name)
        vintages.push({
          vintage_id: v.id as string,
          wine_name: wine.name,
          year: v.year as number | null,
        });
    }
    if (!data || data.length < 1000) break;
  }

  // 3. Match by name and save straight away.
  const { matches } = matchRows(rows, vintages);
  const { data: applied, error: writeError } = await db.rpc('apply_cellartracker', {
    p_matches: matches,
  });
  if (writeError) {
    await log(false, { error: 'apply_failed', detail: writeError.message });
    return reply(500, { error: 'Could not save the CellarTracker facts.' });
  }

  // Logged now, so a timeout in the second pass doesn't make every app start retry.
  await log(true, { version: MATCHER_VERSION, pass: 1, matched: matches.length, applied });

  // 4. Second pass: Claude matches the names the word comparison could not.
  // A failure here keeps the first pass's matches.
  let claudeMatched = 0;
  let claudeApplied: unknown = null;
  let claudeNote: string | null = null;
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const rest = leftovers(
    rows,
    vintages,
    new Set(matches.map((m) => m.vintage_id)),
    new Set(matches.map((m) => m.ct_id ?? '')),
  );
  if (apiKey && rest.apps.length > 0) {
    try {
      const response = await new Anthropic({ apiKey }).beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: PICK_SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: pickPrompt(rest) }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      if (response.stop_reason === 'end_turn' && textBlock && textBlock.type === 'text') {
        const picks = cleanPicks(JSON.parse(textBlock.text), rest);
        const extra = [...picks].map(([vintageId, row]) => ({
          vintage_id: vintageId,
          ...rowFacts(row),
        }));
        if (extra.length > 0) {
          const { data, error } = await db.rpc('apply_cellartracker', { p_matches: extra });
          if (error) claudeNote = `save failed: ${error.message}`;
          else {
            claudeApplied = data;
            claudeMatched = extra.length;
            matches.push(...extra);
          }
        }
      } else claudeNote = `stopped: ${response.stop_reason}`;
    } catch (e) {
      claudeNote = String(e).slice(0, 200);
    }
  }
  // 5. Places (country, region, sub-region, appellation) from CellarTracker,
  // which is exact, replace the spreadsheet's for every matched wine.
  const { data: placesApplied, error: placeError } = await db.rpc('apply_ct_places', {
    p_matches: matches.map((m) => ({ vintage_id: m.vintage_id, ...m.place })),
  });
  const matchedIds = new Set(matches.map((m) => m.vintage_id));
  const usedCt = new Set(matches.map((m) => m.ct_id));
  const unmatchedApp = vintages.length - matchedIds.size;
  const unmatchedCt = rows.filter((r) => !usedCt.has(r.iWine)).length;
  const summary = {
    version: MATCHER_VERSION,
    claude_matched: claudeMatched,
    claude_note: claudeNote,
    claude_applied: claudeApplied,
    ct_rows: rows.length,
    columns: Object.keys(rows[0]),
    app_vintages: vintages.length,
    matched: matches.length,
    unmatched_app: unmatchedApp,
    unmatched_ct: unmatchedCt,
    // A few unmatched names from each side, to check the matching by eye.
    unmatched_app_sample: vintages
      .filter((v) => !matchedIds.has(v.vintage_id))
      .slice(0, 25)
      .map((v) => `${v.wine_name} ${v.year ?? 'NV'}`),
    ct_sample: rows.slice(0, 25).map((r) => `${r.Wine} ${r.Vintage}`),
    applied,
    places: placeError ? `failed: ${placeError.message}` : placesApplied,
  };
  await log(true, summary);
  return reply(200, summary);
});
