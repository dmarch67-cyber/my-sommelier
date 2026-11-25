// Supabase Edge Function: finds label pictures for one wine per call.
//
//   1. Claude Haiku searches the web for pages showing this wine's label, one
//      per vintage owned where it can (labels often change by vintage), plus
//      the winery's or importer's page. CellarTracker, Vinous, Vivino,
//      Wine-Searcher and wine.com are never used.
//   2. The function reads those pages (only where robots.txt allows) and
//      collects the likely label and bottle pictures.
//   3. Claude looks at the pictures: does the label match this wine, which
//      year does it show, is it a label close-up or a whole bottle?
//   4. Each vintage gets the picture showing its own year (close-ups first);
//      the best picture of any year stands in for the wine's other vintages.
//      Pictures are saved in the private "labels" Storage bucket.
// The owner's own photos (label_source 'photo') are never replaced.
//
// Called by a database schedule or by hand through pg_net, like assess-wines:
// the x-assess-secret header must match the 'assess_secret' Vault secret.
// Body: { account_id?, max? } where max caps how many wines may have been
// searched in total (for test runs).

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import {
  BLOCKED_DOMAINS,
  assign,
  cleanPages,
  describe,
  EXT,
  imageCandidates,
  isBlocked,
  LOOK_MODEL,
  LOOK_SCHEMA,
  LOOK_SYSTEM,
  type Look,
  type Media,
  nameWords,
  type Page,
  PAGES_TOOL,
  robotsAllows,
  SEARCH_MODEL,
  SEARCH_SYSTEM,
  sniff,
  type WineIn,
} from './prompt.ts';

const DEFAULT_ACCOUNT = 'b7a2bb88-b2c5-41f4-862c-17d95cd24b01';
const UA = 'MySommelierLabelFinder/1.0 (personal wine-cellar app; one label picture per wine)';
const MAX_PICTURES = 14;
const PER_PAGE = 3;
const MAX_TOTAL_BYTES = 16_000_000; // keeps the request under Claude's size limit
const MAX_BYTES = 3_500_000; // keeps the base64 under Claude's 5 MB image limit
const MIN_BYTES = 6_000; // smaller is an icon or a thumbnail

type Usage = {
  search_input: number;
  search_output: number;
  searches: number;
  look_input: number;
  look_output: number;
  pages: number;
  pictures: number;
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

  let body: { account_id?: string; max?: number } = {};
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

  const { data: wineId, error: claimError } = await db.rpc('claim_label_search', {
    p_account_id: accountId,
    p_max: Number.isInteger(body.max) ? body.max : null,
  });
  if (claimError) return reply(500, { error: claimError.message });
  if (!wineId) return reply(200, { done: true });

  const usage: Usage = {
    search_input: 0,
    search_output: 0,
    searches: 0,
    look_input: 0,
    look_output: 0,
    pages: 0,
    pictures: 0,
  };
  const finish = async (
    result: 'found' | 'none' | 'failed',
    extra: Record<string, unknown> = {},
  ) => {
    await db
      .from('wines')
      .update({ label_search_result: result, label_search_usage: { ...usage, ...extra } })
      .eq('id', wineId);
  };

  try {
    const wine = await loadWine(db, wineId as string);
    if (!wine) {
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

    // 2. Collect pictures from them: a few per page, so every vintage's page
    //    gets a look-in.
    const words = nameWords(wine);
    const pictures: { url: string; page: Page; title: string; bytes: Uint8Array; media: Media }[] =
      [];
    let totalBytes = 0;
    for (const page of pages) {
      if (pictures.length >= MAX_PICTURES) break;
      const html = await readPage(page.url);
      if (!html) continue;
      usage.pages++;
      const title = pageTitle(html);
      let fromPage = 0;
      for (const url of imageCandidates(html, page.url, words)) {
        if (pictures.length >= MAX_PICTURES || fromPage >= PER_PAGE) break;
        if (isBlocked(url) || pictures.some((p) => p.url === url)) continue;
        const got = await download(url, page.url);
        if (got && totalBytes + got.bytes.length <= MAX_TOTAL_BYTES) {
          totalBytes += got.bytes.length;
          pictures.push({ url, page, title, ...got });
          fromPage++;
        }
      }
    }
    usage.pictures = pictures.length;
    if (pictures.length === 0) {
      await finish('none', { pages_tried: pages.map((p) => p.url) });
      return reply(200, { wine: wine.name, result: 'none', pages, usage });
    }

    // 3. Look at them, and match pictures to vintages by the year on the label.
    const look = await lookAt(client, wine, pictures, usage);
    const { byVintage, wine: standIn } = assign(look, pictures.length, wine.vintages);
    if (standIn == null && byVintage.size === 0) {
      await finish('none', { look, pages_tried: pages.map((p) => p.url) });
      return reply(200, { wine: wine.name, result: 'none', look, usage });
    }

    // 4. Save them. Never over the owner's own photos.
    const saved = new Map<number, string>(); // picture number -> storage path
    const save = async (n: number): Promise<string> => {
      const have = saved.get(n);
      if (have) return have;
      const pic = pictures[n - 1];
      const path = `${accountId}/${wine.id}-${crypto.randomUUID().slice(0, 8)}.${EXT[pic.media]}`;
      const { error } = await db.storage
        .from('labels')
        .upload(path, pic.bytes, { contentType: pic.media, upsert: false });
      if (error) throw new Error(`upload: ${error.message}`);
      saved.set(n, path);
      return path;
    };
    const fields = (n: number, path: string) => ({
      label_path: path,
      label_source: 'web',
      label_page_url: pictures[n - 1].page.url,
      label_image_url: pictures[n - 1].url,
    });

    const vintagesDone: Record<string, number | null> = {};
    for (const [vintageId, n] of byVintage) {
      const path = await save(n);
      const { data: up } = await db
        .from('vintages')
        .update(fields(n, path))
        .eq('id', vintageId)
        .or('label_source.is.null,label_source.eq.web')
        .select('id');
      vintagesDone[vintageId] = up?.length ? n : null;
    }
    let wineDone = false;
    if (standIn != null) {
      const path = await save(standIn);
      const { data: up } = await db
        .from('wines')
        .update(fields(standIn, path))
        .eq('id', wine.id)
        .or('label_source.is.null,label_source.eq.web')
        .select('id');
      wineDone = !!up?.length;
    }
    // Tidy up any picture that ended up unused (the owner added a photo meanwhile).
    const used = new Set<number>([
      ...Object.values(vintagesDone).filter((n): n is number => n != null),
      ...(wineDone && standIn != null ? [standIn] : []),
    ]);
    const unused = [...saved].filter(([n]) => !used.has(n)).map(([, path]) => path);
    if (unused.length) await db.storage.from('labels').remove(unused);

    await finish('found', { look, vintages: Object.keys(vintagesDone).length });
    return reply(200, {
      wine: wine.name,
      result: 'found',
      vintages: Object.fromEntries(
        wine.vintages.map((v) => [v.year ?? 'NV', byVintage.has(v.id) ? 'own label' : 'stand-in']),
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
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: describe(wine) }];
  let nudged = false;
  for (let round = 0; round < 5; round++) {
    const message = await client.beta.messages
      .stream({
        model: SEARCH_MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        system: SEARCH_SYSTEM,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 4,
            blocked_domains: BLOCKED_DOMAINS,
          },
          PAGES_TOOL as unknown as Anthropic.Beta.BetaTool,
        ],
        tool_choice: { type: 'auto' },
        messages,
      })
      .finalMessage();
    usage.search_input += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
    usage.search_output += message.usage.output_tokens;
    usage.searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    const call = message.content.find((b) => b.type === 'tool_use' && b.name === PAGES_TOOL.name);
    if (call && call.type === 'tool_use') return cleanPages(call.input);
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

async function readPage(url: string): Promise<string | null> {
  try {
    if (!(await allowedByRobots(url))) return null;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) return null;
    return (await r.text()).slice(0, 2_000_000);
  } catch {
    return null;
  }
}

function pageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (m?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;/g, "'")
    .trim()
    .slice(0, 160);
}

async function download(
  url: string,
  referer: string,
): Promise<{ bytes: Uint8Array; media: Media } | null> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'image/jpeg,image/png,image/webp,image/*',
        Referer: referer,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) return null;
    const media = sniff(bytes);
    return media ? { bytes, media } : null;
  } catch {
    return null;
  }
}

/** Step 3: Claude looks at the pictures and says which, if any, is this wine. */
async function lookAt(
  client: Anthropic,
  wine: WineIn,
  pictures: { bytes: Uint8Array; media: Media; page: Page; title: string }[],
  usage: Usage,
): Promise<Look | null> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  pictures.forEach((p, i) => {
    content.push({
      type: 'text',
      text: `Picture ${i + 1} (from a ${p.page.kind} page titled "${p.title}"):`,
    });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: p.media, data: encodeBase64(p.bytes) },
    });
  });
  content.push({ type: 'text', text: `The wine we want:\n${describe(wine)}` });
  const message = await client.beta.messages.create({
    model: LOOK_MODEL,
    max_tokens: 6000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: LOOK_SCHEMA } },
    system: LOOK_SYSTEM,
    messages: [{ role: 'user', content }],
  });
  usage.look_input += message.usage.input_tokens;
  usage.look_output += message.usage.output_tokens;
  const text = message.content.find((b) => b.type === 'text');
  try {
    return text && text.type === 'text' ? (JSON.parse(text.text) as Look) : null;
  } catch {
    return null;
  }
}
