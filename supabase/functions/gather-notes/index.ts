// Supabase Edge Function: gathers third-party tasting notes for one wine per call.
//
//   1. Claude Haiku searches the web for public pages that quote tasting notes
//      on this wine, one per vintage owned where it can: shops, importers, the
//      winery's press and tech sheets, critics' free pages. CellarTracker,
//      Vinous, WineBerserkers and Vivino are never used.
//   2. The function reads those pages itself (only where robots.txt allows).
//   3. Claude Haiku takes out each note word for word, with who wrote it, the
//      score, the date and the vintage. A note that is not really on its page
//      is thrown away, so nothing is made up.
//   4. The notes are saved in critic_notes, and the vintages' "What critics
//      say" summaries are marked to be rewritten with them.
//
// Called by a database schedule or by hand through pg_net, like find-labels:
// the x-assess-secret header must match the 'assess_secret' Vault secret.
// Body: { account_id?, max?, wine_id? } where max caps how many wines may have
// been searched in total (for test runs), and wine_id redoes one wine.

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import {
  BLOCKED_DOMAINS,
  budget,
  cleanNotes,
  cleanPages,
  describe,
  focus,
  isBlocked,
  NOTES_SCHEMA,
  type Page,
  pagesTool,
  pageText,
  READ_MODEL,
  READ_SYSTEM,
  type ReadPage,
  readText,
  robotsAllows,
  SEARCH_MODEL,
  searchSystem,
  site,
  type WineIn,
} from './prompt.ts';

const DEFAULT_ACCOUNT = 'b7a2bb88-b2c5-41f4-862c-17d95cd24b01';
const UA = 'MySommelierNotes/1.0 (personal wine-cellar app; reads public tasting notes)';
const PAGE_CHARS = 14_000; // about 3,500 tokens of each page
const MAX_PDFS = 3;
const MAX_PDF_BYTES = 4_000_000;

type Usage = {
  search_input: number;
  search_output: number;
  searches: number;
  read_input: number;
  read_output: number;
  pages_tried: number;
  pages_read: number;
  notes: number;
  rejected: number;
};

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

  let body: { account_id?: string; max?: number; wine_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body
  }
  const accountId = body.account_id ?? DEFAULT_ACCOUNT;

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: allowed } = await db.rpc('assess_secret_ok', {
    p_secret: req.headers.get('x-assess-secret') ?? '',
  });
  if (allowed !== true) return reply(401, { error: 'Not allowed.' });

  let wineId: string | null = null;
  if (typeof body.wine_id === 'string') {
    wineId = body.wine_id;
    await db
      .from('wines')
      .update({ notes_searched_at: new Date().toISOString(), notes_search_result: null })
      .eq('id', wineId);
  } else {
    const { data, error } = await db.rpc('claim_notes_search', {
      p_account_id: accountId,
      p_max: Number.isInteger(body.max) ? body.max : null,
    });
    if (error) return reply(500, { error: error.message });
    wineId = data as string | null;
  }
  if (!wineId) return reply(200, { done: true });

  const usage: Usage = {
    search_input: 0,
    search_output: 0,
    searches: 0,
    read_input: 0,
    read_output: 0,
    pages_tried: 0,
    pages_read: 0,
    notes: 0,
    rejected: 0,
  };
  const finish = async (
    result: 'found' | 'none' | 'failed',
    extra: Record<string, unknown> = {},
  ) => {
    await db
      .from('wines')
      .update({ notes_search_result: result, notes_search_usage: { ...usage, ...extra } })
      .eq('id', wineId);
  };

  try {
    const wine = await loadWine(db, wineId);
    if (!wine || wine.vintages.length === 0) {
      await finish('failed', { error: 'wine not found' });
      return reply(404, { error: 'wine not found' });
    }
    const client = new Anthropic({ apiKey });

    // 1. Find pages.
    const pages = await findPages(client, wine, usage);
    if (pages === undefined) {
      await finish('failed', { error: 'search gave no answer' });
      return reply(502, { wine: wine.name, error: 'search gave no answer' });
    }
    usage.pages_tried = pages.length;

    // 2. Read them.
    const read: (ReadPage & { bytes?: Uint8Array })[] = [];
    let pdfs = 0;
    for (const page of pages) {
      const got = await readPage(page.url, pdfs < MAX_PDFS);
      if (!got) continue;
      if (got.pdf) pdfs++;
      read.push(got);
    }
    usage.pages_read = read.length;
    if (read.length === 0) {
      await finish('none', { pages: pages.map((p) => p.url) });
      return reply(200, { wine: wine.name, result: 'none', pages, usage });
    }

    // 3. Take out the notes.
    const raw = await takeNotes(client, wine, read, usage);
    const year = new Date().getFullYear();
    const { notes, rejected } = cleanNotes(raw, wine, read, year);
    usage.rejected = rejected;

    // 4. Save them, and have the critics summaries rewritten with them.
    let added = 0;
    if (notes.length) {
      const { data, error } = await db.rpc('save_critic_notes', {
        p_wine_id: wine.id,
        p_notes: notes,
      });
      if (error) throw new Error(`save: ${error.message}`);
      added = (data as number) ?? 0;
      const touched = [...new Set(notes.map((n) => n.vintage_id))];
      await db
        .from('vintage_assessments')
        .update({ critics_said_at: null })
        .in('vintage_id', touched);
    }
    usage.notes = added;
    await finish(notes.length ? 'found' : 'none', {
      pages: read.map((p) => p.url),
    });
    return reply(200, {
      wine: wine.name,
      result: notes.length ? 'found' : 'none',
      added,
      by_vintage: Object.fromEntries(
        wine.vintages.map((v) => [
          v.year ?? 'NV',
          notes.filter((n) => n.vintage_id === v.id).length,
        ]),
      ),
      usage,
    });
  } catch (e) {
    const credit = e instanceof Anthropic.APIError && /credit|billing/i.test(e.message);
    const msg = credit ? 'out of Anthropic credit' : String(e).slice(0, 300);
    await finish('failed', { error: msg });
    return reply(502, { error: msg });
  }
});

// deno-lint-ignore no-explicit-any
async function loadWine(db: any, id: string): Promise<WineIn | null> {
  const { data: w } = await db
    .from('wines')
    .select(
      'id,name,producer,country,region,appellation,colour,' +
        'vintages(id,year,holdings(quantity,quantity_on_order))',
    )
    .eq('id', id)
    .single();
  if (!w) return null;
  type V = {
    id: string;
    year: number | null;
    holdings: { quantity: number; quantity_on_order: number }[];
  };
  return {
    id: w.id,
    name: w.name,
    producer: w.producer,
    country: w.country,
    region: w.region,
    appellation: w.appellation,
    colour: w.colour,
    vintages: ((w.vintages ?? []) as V[])
      .filter((v) => (v.holdings ?? []).some((h) => h.quantity + h.quantity_on_order > 0))
      .map((v) => ({ id: v.id, year: v.year }))
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0)),
  };
}

/** Step 1: Haiku searches and returns candidate pages, or undefined if it never answers. */
async function findPages(
  client: Anthropic,
  wine: WineIn,
  usage: Usage,
): Promise<Page[] | undefined> {
  const b = budget(wine);
  const tool = pagesTool(wine);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: describe(wine) }];
  let nudged = false;
  for (let round = 0; round < 5; round++) {
    const message = await client.beta.messages
      .stream({
        model: SEARCH_MODEL,
        max_tokens: 6000,
        output_config: { effort: 'low' },
        system: searchSystem(wine),
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: b.searches,
            blocked_domains: BLOCKED_DOMAINS,
          },
          tool as unknown as Anthropic.Beta.BetaTool,
        ],
        tool_choice: { type: 'auto' },
        messages,
      })
      .finalMessage();
    usage.search_input += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
    usage.search_output += message.usage.output_tokens;
    usage.searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    const call = message.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (call && call.type === 'tool_use') return cleanPages(call.input, b.pages);
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    if (message.stop_reason === 'end_turn' && !nudged) {
      nudged = true;
      messages.push({ role: 'assistant', content: message.content });
      messages.push({ role: 'user', content: 'Please call record_pages now.' });
      continue;
    }
    return undefined;
  }
  return undefined;
}

const robotsCache = new Map<string, string | null>();

async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let text: string | null = null;
    try {
      const r = await fetch(`${u.origin}/robots.txt`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(6000),
      });
      text = r.ok ? (await r.text()).slice(0, 200_000) : null;
    } catch {
      text = null;
    }
    robotsCache.set(u.origin, text);
  }
  const robots = robotsCache.get(u.origin);
  return robots ? robotsAllows(robots, u.pathname + u.search) : true;
}

/** Step 2: one page's text (or a PDF tech sheet), if robots.txt allows and it loads. */
async function readPage(
  url: string,
  pdfOk: boolean,
): Promise<(ReadPage & { bytes?: Uint8Array }) | null> {
  try {
    if (isBlocked(url) || !(await allowedByRobots(url))) return null;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok || isBlocked(r.url || url)) return null;
    const type = r.headers.get('content-type') ?? '';
    if (type.includes('pdf')) {
      if (!pdfOk || Number(r.headers.get('content-length') ?? 0) > MAX_PDF_BYTES) return null;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > MAX_PDF_BYTES) return null;
      return { url, site: site(url), text: null, pdf: true, bytes };
    }
    if (!type.includes('html') && !type.includes('text')) return null;
    const text = pageText((await r.text()).slice(0, 3_000_000));
    if (text.length < 200) return null;
    return { url, site: site(url), text, pdf: false };
  } catch {
    return null;
  }
}

/** Step 3: Haiku reads the pages and takes out the notes, word for word. */
async function takeNotes(
  client: Anthropic,
  wine: WineIn,
  pages: (ReadPage & { bytes?: Uint8Array })[],
  usage: Usage,
): Promise<unknown> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: readText(wine) }];
  pages.forEach((p, i) => {
    if (p.pdf && p.bytes) {
      content.push({ type: 'text', text: `Page ${i + 1} (${p.url}), a PDF:` });
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: encodeBase64(p.bytes) },
      });
    } else {
      content.push({
        type: 'text',
        text: `Page ${i + 1} (${p.url}):\n${focus(p.text ?? '', PAGE_CHARS)}`,
      });
    }
  });
  const message = await client.beta.messages
    .stream({
      model: READ_MODEL,
      max_tokens: 32000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: NOTES_SCHEMA } },
      system: READ_SYSTEM,
      messages: [{ role: 'user', content }],
    })
    .finalMessage();
  usage.read_input += message.usage.input_tokens;
  usage.read_output += message.usage.output_tokens;
  const text = message.content.find((b) => b.type === 'text');
  if (message.stop_reason !== 'end_turn' || !text || text.type !== 'text') {
    throw new Error(`reader stopped: ${message.stop_reason}`);
  }
  return JSON.parse(text.text);
}
