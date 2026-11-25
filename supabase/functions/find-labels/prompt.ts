// Prompts and page/picture helpers for find-labels. Pure functions, no I/O,
// so they can be tested without the network.

export const SEARCH_MODEL = 'claude-haiku-5-5';
export const LOOK_MODEL = 'claude-haiku-5-5';

/** Sites we never take from: their terms forbid automated reading, or Dan asked us not to. */
export const BLOCKED_DOMAINS = [
  'cellartracker.com',
  'vinous.com',
  'vivino.com',
  'wine-searcher.com',
  'wine.com',
];

export type WineIn = {
  id: string;
  name: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  colour: string | null;
  /** The vintages still in the cellar (or on order), each wanting its own label. */
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
    years(w).length ? `Vintages owned: ${years(w).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export const SEARCH_SYSTEM = `You find web pages that show the front label of one specific wine, for each vintage the owner has.
Labels often change from vintage to vintage, so look for a page for EACH vintage owned (wine shops usually have one product page per vintage), then a page for the wine in general (the producer's own page).
Prefer pages likely to show a clear front-label close-up or a single bottle.
Search the web, then call record_pages with up to 8 page addresses, best first, each with the vintage the page is about (null if it covers the wine in general).
Rules:
- Every page must be about this exact wine (same producer AND same cuvée/vineyard/bottling), not the producer's home page or another of their wines.
- Never give pages from ${BLOCKED_DOMAINS.join(', ')}.
- Use at most 4 searches. If you find nothing suitable, call record_pages with an empty list.`;

export const PAGES_TOOL = {
  name: 'record_pages',
  description: "Record the pages most likely to show this wine's label, best first.",
  input_schema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            kind: { type: 'string', enum: ['producer', 'importer', 'shop', 'other'] },
            year: { type: ['integer', 'null'], description: 'The vintage the page is about.' },
          },
          required: ['url', 'kind', 'year'],
        },
      },
    },
    required: ['pages'],
  },
} as const;

export type Page = { url: string; kind: string; year: number | null };

export function cleanPages(raw: unknown): Page[] {
  const pages = (raw as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) return [];
  const out: Page[] = [];
  for (const p of pages) {
    const url = typeof p?.url === 'string' ? p.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    if (isBlocked(url)) continue;
    if (out.some((o) => o.url === url)) continue;
    out.push({
      url,
      kind: typeof p?.kind === 'string' ? p.kind : 'other',
      year: Number.isInteger(p?.year) ? p.year : null,
    });
  }
  return out.slice(0, 8);
}

export function isBlocked(url: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

// ---------- reading pages ----------

const STOP = new Set([
  'the',
  'and',
  'de',
  'du',
  'la',
  'le',
  'les',
  'des',
  'di',
  'del',
  'della',
  'von',
  'vineyard',
  'vineyards',
  'estate',
  'winery',
  'wines',
  'wine',
  'domaine',
  'chateau',
  'château',
  'red',
  'white',
]);

/** Distinctive lower-case words of a wine's name, for spotting its picture on a page. */
export function nameWords(w: WineIn): string[] {
  const text = `${w.producer ?? ''} ${w.name}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const words = text.split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !STOP.has(x));
  return [...new Set(words)];
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/g, '"');
}

function resolve(src: string, base: string): string | null {
  try {
    const u = new URL(decode(src.trim()), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Largest candidate in a srcset. */
function fromSrcset(srcset: string): string | null {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const [url, size] = part.trim().split(/\s+/);
    if (!url) continue;
    const w = size ? parseFloat(size) : 1;
    if (!best || w > best.w) best = { url, w };
  }
  return best?.url ?? null;
}

const BAD_IMAGE =
  /(logo|icon|sprite|favicon|avatar|badge|banner|placeholder|blank|pixel|award|medal|flag|payment|social|\.svg)/i;
const GOOD_IMAGE = /(bottle|label|product|packshot|wine|btl|front|shot)/i;

/**
 * Picture addresses on a page that might be the wine's bottle or label, best
 * first: the page's share image, structured product images, then <img> tags
 * whose address or description names the wine or looks like a bottle shot.
 */
export function imageCandidates(html: string, pageUrl: string, words: string[], max = 4): string[] {
  const scored: { url: string; score: number }[] = [];
  const add = (src: string | null, score: number) => {
    if (!src) return;
    const url = resolve(src, pageUrl);
    if (!url || /^data:/i.test(url)) return;
    if (BAD_IMAGE.test(url)) return;
    const prev = scored.find((s) => s.url === url);
    if (prev) prev.score = Math.max(prev.score, score);
    else scored.push({ url, score });
  };

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    if (key === 'og:image' || key === 'og:image:secure_url' || key === 'twitter:image') {
      add(attr(tag, 'content'), 6);
    }
  }

  for (const block of html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ??
    []) {
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    for (const m of body.matchAll(/"image"\s*:\s*(\[[^\]]*\]|"[^"]+"|\{[^}]*\})/g)) {
      for (const u of m[1].matchAll(/"(https?:[^"]+)"/g)) add(u[1].replace(/\\\//g, '/'), 7);
    }
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src =
      attr(tag, 'data-zoom-image') ??
      attr(tag, 'data-large_image') ??
      (attr(tag, 'data-srcset') ? fromSrcset(attr(tag, 'data-srcset')!) : null) ??
      (attr(tag, 'srcset') ? fromSrcset(attr(tag, 'srcset')!) : null) ??
      attr(tag, 'data-src') ??
      attr(tag, 'src');
    if (!src) continue;
    const text =
      `${src} ${attr(tag, 'alt') ?? ''} ${attr(tag, 'title') ?? ''} ${attr(tag, 'class') ?? ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const hits = words.filter((w) => text.includes(w)).length;
    let score = hits * 2 + (GOOD_IMAGE.test(text) ? 2 : 0);
    const width = Number(attr(tag, 'width') ?? 0);
    if (width && width < 80) score -= 5;
    if (score >= 3) add(src, score);
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.url);
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

// ---------- looking at pictures ----------

export const LOOK_SYSTEM = `You check candidate pictures for a wine-cellar app. The owner wants a picture of the FRONT LABEL of one specific wine, ideally one for each vintage they own, because label art often changes from year to year.
Each picture comes from a web page a search found for this wine; you get the page's title too. For every picture say:
- matches: true when it shows a bottle or front label of THIS wine. What you can read on the label must agree with the wine (the producer and/or the specific cuvée, vineyard or bottling name; at least one must be readable) and the page title must point to this exact wine. A label that shows only the cuvée name or the producer's art is fine when the page is clearly about this wine and nothing readable contradicts it. A different cuvée from the same producer is NOT a match.
- year: the vintage you can actually read on the label in the picture (not from the page title), or null if none is readable.
- view: "label" when the front label fills most of the picture (a close-up), "bottle" when it is a whole single bottle with the front label visible, "other" for anything else (logos, vineyard or people photos, cases or several bottles, back labels, crops of artwork with no words).
- clear: true when the label is sharp and big enough to read.`;

export const LOOK_SCHEMA = {
  type: 'object',
  properties: {
    pictures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          shows: { type: 'string', description: 'What you can read and see, briefly.' },
          matches: { type: 'boolean' },
          year: { type: ['integer', 'null'] },
          view: { type: 'string', enum: ['label', 'bottle', 'other'] },
          clear: { type: 'boolean' },
        },
        required: ['number', 'shows', 'matches', 'year', 'view', 'clear'],
        additionalProperties: false,
      },
    },
  },
  required: ['pictures'],
  additionalProperties: false,
} as const;

export type Seen = {
  number: number;
  shows: string;
  matches: boolean;
  year: number | null;
  view: 'label' | 'bottle' | 'other';
  clear: boolean;
};
export type Look = { pictures: Seen[] };

/** Usable pictures, best first: label close-ups before whole bottles, then in page order. */
function usable(look: Look | null, count: number): Seen[] {
  return (look?.pictures ?? [])
    .filter(
      (p) =>
        p.matches &&
        p.clear &&
        p.view !== 'other' &&
        Number.isInteger(p.number) &&
        p.number >= 1 &&
        p.number <= count,
    )
    .sort((a, b) => (a.view === b.view ? a.number - b.number : a.view === 'label' ? -1 : 1));
}

/**
 * Which picture (by number) goes on each vintage, and which one stands in for
 * the wine as a whole. A vintage only gets a picture whose label shows its own
 * year. The stand-in is the best picture of any year, newest year first among
 * equally good ones.
 */
export function assign(
  look: Look | null,
  count: number,
  vintages: { id: string; year: number | null }[],
): { byVintage: Map<string, number>; wine: number | null } {
  const good = usable(look, count);
  const byVintage = new Map<string, number>();
  for (const v of vintages) {
    if (v.year == null) continue;
    const p = good.find((g) => g.year === v.year);
    if (p) byVintage.set(v.id, p.number);
  }
  const rank = (p: Seen) => (p.view === 'label' ? 0 : 1);
  const wine =
    [...good].sort(
      (a, b) => rank(a) - rank(b) || (b.year ?? 0) - (a.year ?? 0) || a.number - b.number,
    )[0]?.number ?? null;
  return { byVintage, wine };
}

// ---------- picture bytes ----------

export type Media = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export function sniff(bytes: Uint8Array): Media | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp';
  return null;
}

export const EXT: Record<Media, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
