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
  years: number[];
};

export function describe(w: WineIn): string {
  const place = [w.appellation, w.region, w.country].filter(Boolean).join(', ');
  return [
    `Wine: ${w.name}`,
    w.producer ? `Producer: ${w.producer}` : null,
    place ? `From: ${place}` : null,
    w.colour ? `Colour: ${w.colour}` : null,
    w.years.length ? `Vintages owned: ${w.years.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export const SEARCH_SYSTEM = `You find web pages that show a picture of one specific wine's bottle or front label.
Search the web, then call record_pages with up to 5 page addresses, best first.
Best: the producer's (winery's) own page for this exact wine. Next: the importer's or distributor's page. Then a wine shop's product page for this wine (any vintage).
Rules:
- The page must be about this exact wine (same producer AND same cuvée/vineyard/bottling), not the producer's home page or another of their wines.
- Never give pages from ${BLOCKED_DOMAINS.join(', ')}.
- Use at most 3 searches. If you find nothing suitable, call record_pages with an empty list.`;

export const PAGES_TOOL = {
  name: 'record_pages',
  description: 'Record the pages most likely to show a picture of this wine, best first.',
  input_schema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            kind: { type: 'string', enum: ['producer', 'importer', 'shop', 'other'] },
          },
          required: ['url', 'kind'],
        },
      },
    },
    required: ['pages'],
  },
} as const;

export type Page = { url: string; kind: string };

export function cleanPages(raw: unknown): Page[] {
  const pages = (raw as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) return [];
  const out: Page[] = [];
  for (const p of pages) {
    const url = typeof p?.url === 'string' ? p.url.trim() : '';
    if (!/^https:\/\//i.test(url) && !/^http:\/\//i.test(url)) continue;
    if (isBlocked(url)) continue;
    if (out.some((o) => o.url === url)) continue;
    out.push({ url, kind: typeof p?.kind === 'string' ? p.kind : 'other' });
  }
  return out.slice(0, 5);
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
  const text = `${w.producer ?? ''} ${w.name}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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
        .replace(/[̀-ͯ]/g, '');
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

export const LOOK_SYSTEM = `You check candidate pictures for a wine-cellar app. The owner wants one picture of the bottle or front label of one specific wine.
Each picture comes from a web page that a search found for this wine; you get the page's title too.
A picture matches when it shows a bottle or front label of THIS wine:
- What you can read on the label must agree with the wine: the producer and/or the specific wine (cuvée, vineyard or bottling) name. At least one of them must be readable on the label, and the page title must point to this exact wine.
- Some labels show only the cuvée name (e.g. "Clio") or only the producer's art; that is fine when the page is clearly about this exact wine and nothing readable contradicts it.
- A different vintage is fine. A different cuvée from the same producer (a different name readable on the label, or a page about a different wine) is NOT a match.
Reject: logos alone, vineyard or people photos, cases or several different bottles, back labels, close crops of artwork with no words, and pictures too small or blurry to read.
Pick the single best matching picture (prefer one whole bottle or a clear front label, upright, plain background), or none.`;

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
        },
        required: ['number', 'shows', 'matches'],
        additionalProperties: false,
      },
    },
    best: {
      type: ['integer', 'null'],
      description: 'Number of the best matching picture, or null.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['pictures', 'best', 'confidence'],
  additionalProperties: false,
} as const;

export type Look = {
  pictures: { number: number; shows: string; matches: boolean }[];
  best: number | null;
  confidence: 'high' | 'medium' | 'low';
};

/** The chosen picture's number, only when the checker is confident it matches. */
export function chosen(look: Look | null, count: number): number | null {
  if (!look || look.best == null || look.confidence === 'low') return null;
  if (!Number.isInteger(look.best) || look.best < 1 || look.best > count) return null;
  const p = look.pictures.find((x) => x.number === look.best);
  return p && p.matches ? look.best : null;
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
