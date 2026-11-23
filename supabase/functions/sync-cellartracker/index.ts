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
//   CT_OWNER_EMAIL            the app sign-in allowed to use that login
// The login belongs to one person, so only that sign-in may use it. Other
// users will need their own CellarTracker connection before this is opened up.

import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

import { exportUrl, looksLikeExport, matchRows, parseCsv, type AppVintage } from './ct.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
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
  const ownerEmail = (Deno.env.get('CT_OWNER_EMAIL') ?? '').trim().toLowerCase();
  if (!ctUser || !ctPassword || !ownerEmail) {
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
  if ((who.user.email ?? '').toLowerCase() !== ownerEmail)
    return reply(200, { skipped: 'not_owner' });

  let force = false;
  try {
    force = (await req.json())?.force === true;
  } catch {
    // no body
  }

  // The owner's account (the one they can write to).
  const { data: member } = await db
    .from('account_members')
    .select('account_id,role')
    .eq('user_id', who.user.id)
    .in('role', ['owner', 'editor'])
    .limit(1)
    .maybeSingle();
  if (!member) return reply(200, { skipped: 'no_account' });
  const accountId = member.account_id as string;

  if (!force) {
    const { data: last } = await db
      .from('enrichment_runs')
      .select('started_at')
      .eq('account_id', accountId)
      .eq('source', 'cellartracker')
      .eq('ok', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last && Date.now() - new Date(last.started_at as string).getTime() < DAY_MS) {
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

  // 3. Match and save.
  const { matches, unmatchedApp, unmatchedCt } = matchRows(rows, vintages);
  const { data: applied, error: writeError } = await db.rpc('apply_cellartracker', {
    p_matches: matches,
  });
  if (writeError) {
    await log(false, { error: 'apply_failed', detail: writeError.message });
    return reply(500, { error: 'Could not save the CellarTracker facts.' });
  }
  const summary = {
    ct_rows: rows.length,
    columns: Object.keys(rows[0]),
    app_vintages: vintages.length,
    matched: matches.length,
    unmatched_app: unmatchedApp,
    unmatched_ct: unmatchedCt,
    applied,
  };
  await log(true, summary);
  return reply(200, summary);
});
