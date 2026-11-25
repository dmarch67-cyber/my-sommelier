// Prompts and pure helpers for gather-notes. No Deno or Node APIs, so the
// app's tests can import it too.

export const SEARCH_MODEL = 'claude-haiku-5-5';
export const READ_MODEL = 'claude-haiku-5-5';

/**
 * Sites never read: CellarTracker, Vinous and WineBerserkers forbid automated
 * reading in their terms; Vivino is not used by choice. Wine-Searcher and
 * wine.com block robots.
 */
export const BLOCKED_DOMAINS = [
  'cellartracker.com',
  'vinous.com',
  'wineberserkers.com',
  'vivino.com',
  'wine-searcher.com',
  'wine.com',
];

export const KINDS = ['critic', 'merchant', 'winery', 'community'] as const;
export type Kind = (typeof KINDS)[number];

export type WineIn = {
  id: string;
  name: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  colour: string | null;
  /** The vintages still in the cellar (or on order). */
  vintages: { id: string; year: number | null }[];
};

function years(w: WineIn): number[] {
  return [...new Set(w.vintages.map((v) => v.year).filter((y): y is number => y != null))].sort();
}

export function describe(w: WineIn): string {
  const place = [w.appellation, w.region, w.country].filter(Boolean).join(', ');
  return [
    `Wine: ${w.name}`,
    w.producer ? `Producer: ${w.producer}` : null,
    place ? `From: ${place}` : null,
    w.colour ? `Colour: ${w.colour}` : null,
    years(w).length ? `Vintages owned: ${years(w).join(', ')}` : 'Vintage: NV',
  ]
    .filter(Boolean)
    .join('\n');
}

/** How many searches and pages a wine gets: more vintages, more pages. */
export function budget(w: WineIn): { searches: number; pages: number } {
  const n = Math.max(1, w.vintages.length);
  return { searches: Math.min(3 + Math.ceil(n / 2), 8), pages: Math.min(4 + 2 * n, 16) };
}

// ---------- step 1: finding pages ----------

export function searchSystem(w: WineIn): string {
  const b = budget(w);
  return `You find public web pages that quote tasting notes on one specific wine, for each vintage the owner has. The best pages quote critics' notes with scores (Wine Advocate, Jeb Dunnuck, James Suckling, Wine Spectator, Decanter, Burghound, Jancis Robinson, Wine Enthusiast, Vinous critics and others): wine shops' product pages, importers' and distributors' pages, the winery's own press, trade or tech-sheet pages (PDF tech sheets are fine), and critics' free pages and newsletters.
Look for a page for EACH vintage owned (shops usually have one page per vintage); a page may cover several vintages.
Search the web, then call record_pages with up to ${b.pages} page addresses, most useful first, each with the vintage it is about (null if it covers several or the wine in general).
Rules:
- Every page must be about this exact wine (same producer AND same cuvée, vineyard or bottling), not the producer's home page or another of their wines.
- Never give pages from ${BLOCKED_DOMAINS.join(', ')}.
- Use at most ${b.searches} searches. If you find nothing suitable, call record_pages with an empty list.`;
}

export function pagesTool(w: WineIn) {
  return {
    name: 'record_pages',
    description: 'Record the pages most likely to quote tasting notes on this wine, best first.',
    input_schema: {
      type: 'object',
      properties: {
        pages: {
          type: 'array',
          maxItems: budget(w).pages,
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['shop', 'importer', 'winery', 'critic', 'other'],
              },
              year: { type: ['integer', 'null'], description: 'The vintage the page is about.' },
            },
            required: ['url', 'kind', 'year'],
          },
        },
      },
      required: ['pages'],
    },
  } as const;
}

export type Page = { url: string; kind: string; year: number | null };

export function isBlocked(url: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

export function cleanPages(raw: unknown, max: number): Page[] {
  const pages = (raw as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) return [];
  const out: Page[] = [];
  for (const p of pages) {
    const url = typeof p?.url === 'string' ? p.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || isBlocked(url)) continue;
    if (out.some((o) => o.url === url)) continue;
    out.push({
      url,
      kind: typeof p?.kind === 'string' ? p.kind : 'other',
      year: Number.isInteger(p?.year) ? p.year : null,
    });
  }
  return out.slice(0, max);
}

// ---------- step 2: reading pages ----------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ocirc: 'ô',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
};

/** The readable text of an HTML page: no scripts, styles, menus' markup or tags. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const NOTE_HINTS =
  /\b(points?|pts|\/100|\d{2}\+?\s*-\s*\d{2}|advocate|parker|suckling|dunnuck|spectator|vinous|galloni|burghound|jancis|decanter|enthusiast|tasting note|palate|nose|aromas?|tannins?|finish)\b/i;

/**
 * Cuts a long page down to the parts most likely to hold tasting notes: the
 * paragraphs that mention scores, critics or tasting words, with a little
 * around them, up to maxChars.
 */
export function focus(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const lines = text.split('\n');
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (NOTE_HINTS.test(l)) for (let j = i - 1; j <= i + 2; j++) if (j >= 0) keep.add(j);
  });
  let out = '';
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i >= lines.length) continue;
    const add = (i === last + 1 ? '\n' : '\n…\n') + lines[i];
    if (out.length + add.length > maxChars) break;
    out += add;
    last = i;
  }
  return out.trim() || text.slice(0, maxChars);
}

// ---------- step 3: taking out the notes ----------

export const READ_SYSTEM = `You take tasting notes out of web pages for a private wine-cellar app. The owner wants to read what critics and other tasters have said about the wines in their cellar.

You get one wine (with the vintages owned, each with its vintage_id) and the text of some pages about it. From each page take every tasting note on THIS wine for a vintage owned:
- A critic's or publication's note: author is the critic and publication as the page names them, for example "Lisa Perrotti-Brown, Wine Advocate", "Jeb Dunnuck", "James Suckling", "Wine Spectator". kind "critic".
- A note by the shop's or importer's own buyer or staff: author "<shop name> staff" or the person named. kind "merchant".
- The winery's own tasting note or winemaker's note: author "<winery> (winemaker's note)". kind "winery".
- A note by an ordinary drinker quoted on the page: kind "community".

For each note:
- note: copy the note as the page gives it, word for word. Never write a note yourself, never fill in missing words, and never take a note from memory. If the note is longer than about 150 words, stop at the end of a sentence near there and add "…".
- score: as given ("96", "94-96", "17.5/20", "4.5 stars"), or null.
- noted_on: when it was written or published if the page says (YYYY, YYYY-MM or YYYY-MM-DD), or null.
- vintage_id: the owned vintage the note is about. Only take a note when the page makes clear which vintage it is about. Skip notes on other vintages, other wines from the same producer, or a different bottling.
- page: the number of the page you took it from.

A page with no notes is fine; an empty list is fine. Do not take shop marketing blurbs that are not tasting notes ("A great gift", "Limited stock").`;

export const NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['vintage_id', 'author', 'kind', 'score', 'noted_on', 'note', 'page'],
        properties: {
          vintage_id: { type: 'string' },
          author: { type: 'string' },
          kind: { type: 'string', enum: [...KINDS] },
          score: { type: ['string', 'null'] },
          noted_on: { type: ['string', 'null'] },
          note: { type: 'string' },
          page: { type: 'integer' },
        },
      },
    },
  },
} as const;

export function readText(w: WineIn): string {
  const lines = [describe(w), '', 'Vintages owned:'];
  for (const v of w.vintages) lines.push(`- vintage_id ${v.id}: ${v.year ?? 'NV'}`);
  return lines.join('\n');
}

export type ReadPage = { url: string; site: string; text: string | null; pdf: boolean };

export type NoteOut = {
  vintage_id: string;
  author: string;
  kind: Kind;
  score: string | null;
  noted_on: string | null;
  note: string;
  source_url: string;
  source_site: string;
};

/** Lower-case words only, for checking that a note really is on its page. */
export function plain(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when the note is on the page: at least 80% of its runs of five words
 * appear in the page text. A note Claude wrote itself (or remembered) fails.
 */
export function onPage(note: string, page: string): boolean {
  const words = plain(note.replace(/…\s*$/, '')).split(' ').filter(Boolean);
  if (words.length < 5) return false;
  const text = ' ' + plain(page) + ' ';
  let found = 0;
  let total = 0;
  for (let i = 0; i + 5 <= words.length; i++) {
    total++;
    if (text.includes(' ' + words.slice(i, i + 5).join(' ') + ' ')) found++;
  }
  return total > 0 && found / total >= 0.8;
}

/** The page's site, for "Read on decanter.com". */
export function site(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function cleanDate(s: unknown, maxYear: number): string | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})(-\d{2})?(-\d{2})?$/);
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 1950 || y > maxYear) return null;
  return m[0];
}

/**
 * Checks Claude's answer: owned vintages only, a real page, and (for web
 * pages, whose text we hold) the note must actually be on that page. PDF tech
 * sheets are read by Claude directly, so their notes are taken as given.
 */
export function cleanNotes(
  raw: unknown,
  w: WineIn,
  pages: ReadPage[],
  year: number,
): { notes: NoteOut[]; rejected: number } {
  const ids = new Set(w.vintages.map((v) => v.id));
  const list = (raw as { notes?: unknown })?.notes;
  const notes: NoteOut[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  for (const n of Array.isArray(list) ? list : []) {
    const r = n as Record<string, unknown>;
    const page = Number.isInteger(r?.page) ? pages[(r.page as number) - 1] : undefined;
    const note = typeof r?.note === 'string' ? r.note.replace(/\s+/g, ' ').trim() : '';
    const author = typeof r?.author === 'string' ? r.author.replace(/\s+/g, ' ').trim() : '';
    if (
      !page ||
      typeof r.vintage_id !== 'string' ||
      !ids.has(r.vintage_id) ||
      !KINDS.includes(r.kind as Kind) ||
      note.length < 20 ||
      !author ||
      /vivino|cellartracker|vinous\.com|wineberserkers/i.test(author)
    ) {
      rejected++;
      continue;
    }
    if (!page.pdf && !(page.text && onPage(note, page.text))) {
      rejected++;
      continue;
    }
    const key = `${r.vintage_id}|${author.toLowerCase()}|${plain(note).slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score =
      typeof r.score === 'string' && r.score.trim() ? r.score.trim().slice(0, 20) : null;
    notes.push({
      vintage_id: r.vintage_id,
      author: author.slice(0, 120),
      kind: r.kind as Kind,
      score,
      noted_on: cleanDate(r.noted_on, year),
      note: note.slice(0, 2000),
      source_url: page.url.slice(0, 500),
      source_site: page.site,
    });
  }
  return { notes, rejected };
}

/** True if robots.txt lets any robot read this path (simple reading of "User-agent: *"). */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  let any = false;
  const rules: { allow: boolean; path: string }[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (any && rules.length) break; // the "*" group ended
      applies = value === '*';
      if (applies) any = true;
    } else if (applies && (key === 'disallow' || key === 'allow')) {
      if (value) rules.push({ allow: key === 'allow', path: value });
    }
  }
  let best: { allow: boolean; len: number } = { allow: true, len: -1 };
  for (const r of rules) {
    const pattern = new RegExp(
      '^' +
        r.path
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\\$$/, '$'),
    );
    if (pattern.test(path) && r.path.length > best.len)
      best = { allow: r.allow, len: r.path.length };
  }
  return best.allow;
}
