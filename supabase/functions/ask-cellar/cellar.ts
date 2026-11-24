// "Ask anything" about the cellar: the rows the app sends, the exact lookup
// Claude uses to answer, and the prompt. Plain TypeScript with no Deno or Node
// APIs, so the app's tests can import it too.
//
// Claude never counts or adds up by eye. It calls find_wines, which filters,
// counts, sums and sorts here in code, and writes its answer from the result.

export const MODEL = 'claude-opus-5-5';

/** Most rows accepted per question (Dan has about 1,000 wine-by-cellar lines). */
export const MAX_ROWS = 5000;
/** Most lookups Claude may make for one question. */
export const MAX_TOOL_ROUNDS = 6;
/** Most wines shown as cards under an answer. */
export const MAX_CARDS = 8;

export type ReadyState = 'young' | 'ready' | 'peak' | 'soon' | 'past' | 'unknown';
export const READY_STATES: ReadyState[] = ['young', 'ready', 'peak', 'soon', 'past', 'unknown'];

/** One wine-vintage in one cellar, as the app describes it. */
export type AskRow = {
  /** The vintage id (also what the app opens when a card is tapped). */
  id: string;
  wine_id: string;
  cellar: string;
  name: string;
  producer: string | null;
  vintage: number | null;
  country: string | null;
  region: string | null;
  sub_region: string | null;
  appellation: string | null;
  colour: string | null;
  body: string | null;
  grapes: string[];
  /** Physical bottles of any size (magnums count as one bottle each). */
  bottles: number;
  magnums: number;
  other_sizes: number;
  on_order: number;
  /** Best score on a 100-point scale, and as written ("93-95"). */
  score: number | null;
  score_text: string | null;
  drink_from: number | null;
  drink_to: number | null;
  ready: ReadyState;
  /** "At its peak", "Drink soon"... */
  ready_label: string;
  /** How far along it is: 0 = not open yet, 1 = end of its window, above 1 = past it. */
  maturity: number | null;
  /** What paid per bottle (average over the lines), and in which currency. */
  price: number | null;
  currency: string | null;
  /** Total paid for the bottles in hand (bottles with a known price only). */
  cost: number | null;
  priced_bottles: number;
  /** The critics summary shown on the Wine page. */
  critics: string | null;
  /** The owner's own notes, newest first, short. */
  my_notes: string[];
};

// Cleaning what the app sends ---------------------------------------------------

const str = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const strOrNull = (v: unknown, max = 200): string | null => str(v, max) || null;
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v: unknown): number => Math.max(0, int(v) ?? 0);

/** Validates one row from the app; anything malformed is dropped. */
export function cleanRow(r: unknown): AskRow | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const id = str(o.id, 64);
  const name = str(o.name);
  if (!id || !name) return null;
  const ready = READY_STATES.includes(o.ready as ReadyState) ? (o.ready as ReadyState) : 'unknown';
  return {
    id,
    wine_id: str(o.wine_id, 64),
    cellar: str(o.cellar, 80) || 'Cellar',
    name,
    producer: strOrNull(o.producer),
    vintage: int(o.vintage),
    country: strOrNull(o.country, 80),
    region: strOrNull(o.region, 80),
    sub_region: strOrNull(o.sub_region, 80),
    appellation: strOrNull(o.appellation, 80),
    colour: strOrNull(o.colour, 20),
    body: strOrNull(o.body, 20),
    grapes: Array.isArray(o.grapes)
      ? o.grapes
          .slice(0, 8)
          .map((g) => str(g, 40))
          .filter(Boolean)
      : [],
    bottles: count(o.bottles),
    magnums: count(o.magnums),
    other_sizes: count(o.other_sizes),
    on_order: count(o.on_order),
    score: num(o.score),
    score_text: strOrNull(o.score_text, 16),
    drink_from: int(o.drink_from),
    drink_to: int(o.drink_to),
    ready,
    ready_label: str(o.ready_label, 60),
    maturity: num(o.maturity),
    price: num(o.price),
    currency: strOrNull(o.currency, 3),
    cost: num(o.cost),
    priced_bottles: count(o.priced_bottles),
    critics: strOrNull(o.critics, 900),
    my_notes: Array.isArray(o.my_notes)
      ? o.my_notes
          .slice(0, 4)
          .map((n) => str(n, 300))
          .filter(Boolean)
      : [],
  };
}

export function cleanRows(v: unknown): AskRow[] {
  return (Array.isArray(v) ? v : [])
    .slice(0, MAX_ROWS)
    .map(cleanRow)
    .filter((r): r is AskRow => r !== null);
}

// The lookup ------------------------------------------------------------------

export const SORTS = [
  'most_mature',
  'least_mature',
  'drink_by_soonest',
  'best_score',
  'oldest_vintage',
  'youngest_vintage',
  'most_bottles',
  'highest_price',
  'lowest_price',
  'name',
] as const;
export type Sort = (typeof SORTS)[number];

export const GROUPS = [
  'cellar',
  'country',
  'region',
  'sub_region',
  'appellation',
  'colour',
  'grape',
  'producer',
  'vintage',
  'ready',
] as const;
export type Group = (typeof GROUPS)[number];

export type FindInput = {
  cellars?: string[];
  colours?: string[];
  bodies?: string[];
  place?: string;
  grape?: string;
  producer?: string;
  text?: string;
  vintage_from?: number;
  vintage_to?: number;
  min_score?: number;
  ready?: ReadyState[];
  drink_by_year?: number;
  min_price?: number;
  max_price?: number;
  large_format?: boolean;
  on_order_only?: boolean;
  include_on_order?: boolean;
  sort?: Sort;
  group_by?: Group;
  limit?: number;
};

export const FIND_TOOL = {
  name: 'find_wines',
  description:
    'Look up wines in the owner\'s cellars. Filters are combined with AND. Returns exact totals for everything that matched (wines, bottles, magnums, on order, total paid per currency), optional group counts, and the top matching wines in the chosen order. Use this for every fact about the cellar; never estimate. Call it again with different filters when needed. Text filters ignore case and accents and match the start of words ("bord" finds "Bordeaux").',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cellars: {
        type: 'array',
        items: { type: 'string' },
        description: 'Cellar names to include. Omit for all cellars.',
      },
      colours: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'orange'],
        },
      },
      bodies: { type: 'array', items: { type: 'string', enum: ['light', 'medium', 'full'] } },
      place: {
        type: 'string',
        description:
          'Country, region, sub-region or appellation, e.g. "Bordeaux", "Napa Valley", "Pauillac", "Italy".',
      },
      grape: { type: 'string', description: 'e.g. "Pinot Noir", "Nebbiolo".' },
      producer: { type: 'string' },
      text: {
        type: 'string',
        description: 'Words that must all appear in the wine name, producer, place or grapes.',
      },
      vintage_from: { type: 'integer' },
      vintage_to: { type: 'integer' },
      min_score: { type: 'number', description: 'Best score at least this (100-point scale).' },
      ready: {
        type: 'array',
        items: { type: 'string', enum: READY_STATES },
        description:
          'young = not ready yet; ready = in its window; peak = at its best now; soon = drink soon, window closing; past = past its window; unknown = no window known.',
      },
      drink_by_year: {
        type: 'integer',
        description: 'Only wines whose drinking window ends in or before this year.',
      },
      min_price: { type: 'number', description: 'Price paid per bottle, at least.' },
      max_price: { type: 'number', description: 'Price paid per bottle, at most.' },
      large_format: {
        type: 'boolean',
        description: 'Only wines held in magnums or other large sizes.',
      },
      on_order_only: { type: 'boolean', description: 'Only wines with bottles on order.' },
      include_on_order: {
        type: 'boolean',
        description: 'Also list wines that are only on order (none in hand). Default false.',
      },
      sort: {
        type: 'string',
        enum: SORTS,
        description:
          'most_mature = furthest through its drinking window first (past-window wines first). drink_by_soonest = window ending soonest first.',
      },
      group_by: { type: 'string', enum: GROUPS, description: 'Also count matches per group.' },
      limit: { type: 'integer', description: 'How many wines to list (default 12, at most 40).' },
    },
  },
} as const;

export const DETAILS_TOOL = {
  name: 'wine_details',
  description:
    "Read more about specific wines: what critics and drinkers say, the owner's own tasting notes, and the dishes the app suggests with each wine. Use it for questions about taste, style, quality or food, after finding candidate wines with find_wines.",
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ids'],
    properties: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Wine ids from find_wines, at most 10.',
      },
    },
  },
} as const;

/** Lower-case, no accents, punctuation to spaces. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every word of `needle` starts a word somewhere in `hay`. */
function wordsMatch(hay: string, needle: string): boolean {
  const words = fold(needle).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const h = ` ${fold(hay)}`;
  return words.every((w) => h.includes(` ${w}`));
}

const COLOUR_ALIASES: Record<string, string> = { rosé: 'rose', pink: 'rose', bubbly: 'sparkling' };

function placeText(r: AskRow): string {
  return [r.country, r.region, r.sub_region, r.appellation].filter(Boolean).join(' ');
}

function matches(r: AskRow, q: FindInput): boolean {
  if (q.cellars?.length && !q.cellars.some((c) => fold(c) === fold(r.cellar))) return false;
  if (q.colours?.length) {
    const want = q.colours.map((c) => COLOUR_ALIASES[c.toLowerCase()] ?? fold(c));
    if (!r.colour || !want.includes(fold(r.colour))) return false;
  }
  if (q.bodies?.length && (!r.body || !q.bodies.map(fold).includes(fold(r.body)))) return false;
  if (q.place && !wordsMatch(placeText(r), q.place)) return false;
  if (q.grape && !r.grapes.some((g) => wordsMatch(g, q.grape!))) return false;
  if (q.producer && !wordsMatch(`${r.producer ?? ''} ${r.name}`, q.producer)) return false;
  if (
    q.text &&
    !wordsMatch(
      [r.name, r.producer, placeText(r), r.grapes.join(' '), r.vintage ?? 'NV'].join(' '),
      q.text,
    )
  )
    return false;
  if (q.vintage_from != null && (r.vintage == null || r.vintage < q.vintage_from)) return false;
  if (q.vintage_to != null && (r.vintage == null || r.vintage > q.vintage_to)) return false;
  if (q.min_score != null && (r.score == null || r.score < q.min_score)) return false;
  if (q.ready?.length && !q.ready.includes(r.ready)) return false;
  if (q.drink_by_year != null && (r.drink_to == null || r.drink_to > q.drink_by_year)) return false;
  if (q.min_price != null && (r.price == null || r.price < q.min_price)) return false;
  if (q.max_price != null && (r.price == null || r.price > q.max_price)) return false;
  if (q.large_format && r.magnums + r.other_sizes === 0) return false;
  if (q.on_order_only && r.on_order === 0) return false;
  if (!q.on_order_only && !q.include_on_order && r.bottles === 0) return false;
  return true;
}

const last = Number.POSITIVE_INFINITY;
const byName = (a: AskRow, b: AskRow) =>
  a.name.localeCompare(b.name) || (a.vintage ?? 0) - (b.vintage ?? 0);

function sorter(sort: Sort): (a: AskRow, b: AskRow) => number {
  const desc = (f: (r: AskRow) => number | null) => (a: AskRow, b: AskRow) =>
    (f(b) ?? -last) - (f(a) ?? -last) || byName(a, b);
  const asc = (f: (r: AskRow) => number | null) => (a: AskRow, b: AskRow) =>
    (f(a) ?? last) - (f(b) ?? last) || byName(a, b);
  switch (sort) {
    case 'most_mature':
      return desc((r) => r.maturity);
    case 'least_mature':
      return asc((r) => r.maturity);
    case 'drink_by_soonest':
      return asc((r) => r.drink_to);
    case 'best_score':
      return desc((r) => r.score);
    case 'oldest_vintage':
      return asc((r) => r.vintage);
    case 'youngest_vintage':
      return desc((r) => r.vintage);
    case 'most_bottles':
      return desc((r) => r.bottles);
    case 'highest_price':
      return desc((r) => r.price);
    case 'lowest_price':
      return asc((r) => r.price);
    default:
      return byName;
  }
}

function groupKeys(r: AskRow, g: Group): string[] {
  switch (g) {
    case 'grape':
      return r.grapes.length ? r.grapes : ['(grape not known)'];
    case 'vintage':
      return [r.vintage == null ? 'NV' : String(r.vintage)];
    default: {
      const v = r[g];
      return [v == null || v === '' ? '(not known)' : String(v)];
    }
  }
}

export type FindResult = {
  matched: {
    /** Distinct wine-vintages (a wine in two cellars counts once). */
    wines: number;
    bottles: number;
    magnums: number;
    on_order: number;
    paid: { currency: string; total: number; bottles_priced: number }[];
    bottles_without_price: number;
  };
  groups?: { key: string; wines: number; bottles: number }[];
  wines: {
    id: string;
    cellar: string;
    wine: string;
    place: string;
    style: string;
    grapes: string;
    bottles: number;
    on_order?: number;
    sizes?: string;
    score: string | null;
    window: string;
    ready: string;
    paid_per_bottle?: string;
  }[];
  more_not_listed: number;
};

/** The exact lookup behind find_wines. */
export function findWines(rows: AskRow[], input: FindInput): FindResult {
  const q = input ?? {};
  const hits = rows.filter((r) => matches(r, q));
  const paid = new Map<string, { total: number; bottles: number }>();
  let unpriced = 0;
  for (const r of hits) {
    if (r.cost != null && r.currency && r.priced_bottles > 0) {
      const p = paid.get(r.currency) ?? { total: 0, bottles: 0 };
      p.total += r.cost;
      p.bottles += r.priced_bottles;
      paid.set(r.currency, p);
    }
    unpriced += Math.max(0, r.bottles - r.priced_bottles);
  }
  const result: FindResult = {
    matched: {
      wines: new Set(hits.map((r) => r.id)).size,
      bottles: hits.reduce((s, r) => s + r.bottles, 0),
      magnums: hits.reduce((s, r) => s + r.magnums, 0),
      on_order: hits.reduce((s, r) => s + r.on_order, 0),
      paid: [...paid.entries()].map(([currency, p]) => ({
        currency,
        total: Math.round(p.total * 100) / 100,
        bottles_priced: p.bottles,
      })),
      bottles_without_price: unpriced,
    },
    wines: [],
    more_not_listed: 0,
  };
  if (q.group_by && GROUPS.includes(q.group_by)) {
    const groups = new Map<string, { ids: Set<string>; bottles: number }>();
    for (const r of hits)
      for (const k of groupKeys(r, q.group_by)) {
        const g = groups.get(k) ?? { ids: new Set(), bottles: 0 };
        g.ids.add(r.id);
        g.bottles += r.bottles;
        groups.set(k, g);
      }
    result.groups = [...groups.entries()]
      .map(([key, g]) => ({ key, wines: g.ids.size, bottles: g.bottles }))
      .sort((a, b) => b.bottles - a.bottles || b.wines - a.wines || a.key.localeCompare(b.key))
      .slice(0, 40);
  }
  const limit = Math.min(Math.max(Math.round(q.limit ?? 12), 1), 40);
  const sorted = [...hits].sort(sorter(SORTS.includes(q.sort as Sort) ? (q.sort as Sort) : 'name'));
  result.wines = sorted.slice(0, limit).map(listed);
  result.more_not_listed = Math.max(0, sorted.length - limit);
  return result;
}

function money(amount: number, currency: string): string {
  return `${Math.round(amount * 100) / 100} ${currency}`;
}

function listed(r: AskRow): FindResult['wines'][number] {
  const sizes = [
    r.magnums ? `${r.magnums} magnum${r.magnums === 1 ? '' : 's'}` : '',
    r.other_sizes ? `${r.other_sizes} other large format` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    id: r.id,
    cellar: r.cellar,
    wine: `${r.name} ${r.vintage ?? 'NV'}`,
    place: [r.appellation, r.sub_region, r.region, r.country]
      .filter((p, i, all): p is string => !!p && all.indexOf(p) === i)
      .join(', '),
    style: [r.colour, r.body ? `${r.body} body` : null].filter(Boolean).join(', '),
    grapes: r.grapes.join(', '),
    bottles: r.bottles,
    ...(r.on_order ? { on_order: r.on_order } : {}),
    ...(sizes ? { sizes } : {}),
    score: r.score_text,
    window:
      r.drink_from || r.drink_to ? `${r.drink_from ?? '?'}-${r.drink_to ?? '?'}` : 'not known',
    ready: r.ready_label || r.ready,
    ...(r.price != null && r.currency ? { paid_per_bottle: money(r.price, r.currency) } : {}),
  };
}

export type FoodLine = { wine_id: string; dishes: string[] };

/** What wine_details returns. Food comes from the database (see index.ts). */
export function wineDetails(rows: AskRow[], ids: unknown, food: FoodLine[] = []) {
  const want = (Array.isArray(ids) ? ids : []).filter((i): i is string => typeof i === 'string');
  const seen = new Set<string>();
  const out: {
    id: string;
    wine: string;
    cellars: string;
    critics: string | null;
    my_notes: string[];
    dishes: string[];
  }[] = [];
  for (const id of want.slice(0, 10)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const lines = rows.filter((r) => r.id === id);
    if (!lines.length) continue;
    const r = lines[0];
    out.push({
      id,
      wine: `${r.name} ${r.vintage ?? 'NV'}`,
      cellars: lines.map((l) => `${l.cellar} (${l.bottles})`).join(', '),
      critics: r.critics,
      my_notes: r.my_notes,
      dishes: food.find((f) => f.wine_id === r.wine_id)?.dishes ?? [],
    });
  }
  return { wines: out };
}

/** Runs a tool call by name. Unknown tools get an error the model can read. */
export function runTool(
  rows: AskRow[],
  name: string,
  input: unknown,
  food: FoodLine[] = [],
): unknown {
  if (name === 'find_wines') return findWines(rows, (input ?? {}) as FindInput);
  if (name === 'wine_details')
    return wineDetails(rows, (input as { ids?: unknown } | null)?.ids, food);
  return { error: `No tool called ${name}.` };
}

// The prompt and the answer ----------------------------------------------------------

export type Answer = { answer: string; wine_ids: string[] };

export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'wine_ids'],
  properties: {
    answer: { type: 'string' },
    wine_ids: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const SYSTEM = `You are the private sommelier for one collector, answering questions about their own wine cellars in the My Sommelier app. They type or say a question; you answer it from their real cellar data.

How to work:
- Use find_wines for every fact about the cellar: counts, totals, which wines, what is ready. It is exact. Never count, add up or guess from memory. Call it as many times as you need (for example once per cellar, or with group_by).
- For taste, style, quality or food questions, find candidate wines first, then read wine_details for the most promising few.
- Scope: when the question names a cellar, use that cellar. When it does not, use the cellar the owner is looking at (given below); if they are looking at all cellars, use all of them.
- "Mature" means furthest through its drinking window (sort most_mature). "Drink before it fades" means ready states soon or past, or sort drink_by_soonest.
- Prices are what the owner paid, not today's market value. If asked about value, give the total paid and say that it is the purchase cost, and how many bottles have no price recorded.
- Bottles are physical bottles in hand; magnums count as one bottle each. Mention bottles on order only when relevant.
- General wine questions (what a term means, how to serve something) can be answered from your own knowledge, briefly, tied to their cellar where useful.

How to answer:
- "answer": plain, warm, conversational English for a non-expert. Lead with the direct answer, including exact numbers when asked. One to four short sentences; a short list of names is fine when they asked for several. No markdown headings, no tables, no ids, no tool names.
- Say which cellar(s) the answer covers when it matters.
- If nothing matches, say so plainly and suggest the closest thing they do have.
- "wine_ids": the ids of up to ${MAX_CARDS} wines you name or recommend, best first, so the app can show them as cards. Use ids exactly as find_wines returned them. Empty when no particular wines are relevant (for example a pure count across hundreds of wines).`;

export function contextText(opts: {
  question: string;
  cellars: string[];
  lookingAt: string | null;
  year: number;
  palate?: string;
}): string {
  const looking = opts.lookingAt ? `the ${opts.lookingAt} cellar` : 'all cellars together';
  return `This year: ${opts.year}.
Their cellars: ${opts.cellars.join(', ') || 'none'}.
They are looking at: ${looking}.
${opts.palate ? `Their palate: ${opts.palate}\n` : ''}
Question: ${opts.question}`;
}

/** Keeps only card ids that exist, each once, at most MAX_CARDS. */
export function cleanAnswer(raw: unknown, rows: AskRow[]): Answer | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const answer = typeof o.answer === 'string' ? o.answer.trim().slice(0, 2000) : '';
  if (!answer) return null;
  const known = new Set(rows.map((r) => r.id));
  const seen = new Set<string>();
  const wine_ids: string[] = [];
  for (const id of Array.isArray(o.wine_ids) ? o.wine_ids : []) {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    wine_ids.push(id);
    if (wine_ids.length >= MAX_CARDS) break;
  }
  return { answer, wine_ids };
}
