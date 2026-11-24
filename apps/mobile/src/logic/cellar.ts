/**
 * Pure cellar logic: grouping holdings into list rows, totals, search, sort,
 * scores and the ripeness bar. No React and no Supabase here, so it runs in
 * plain Node tests (test/*.test.ts) and can be reused when the app moves to
 * an on-device copy of the data.
 */

export type Cellar = {
  id: string;
  name: string;
  location: string | null;
  currency: string;
  sort_order: number;
};

/** One row of the cellar_inventory view (one holding). */
export type InventoryRow = {
  holding_id: string;
  account_id: string;
  cellar_id: string;
  cellar_name: string;
  wine_id: string;
  wine_name: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  /** Napa Valley, Médoc… (added after the first release, so may be missing). */
  sub_region?: string | null;
  colour: string | null;
  vintage_id: string;
  vintage: number | null;
  drink_from: number | null;
  drink_to: number | null;
  bottle_size_ml: number;
  bottle_size_label: string;
  is_non_standard_size: boolean;
  quantity: number;
  quantity_on_order: number;
  unit_price: number | null;
  currency: string | null;
  /** Filled in automatically (enrichment); absent in older test fixtures. */
  body?: string | null;
  grapes?: string[];
  /** 'estimate' when the window was filled in automatically rather than from a critic. */
  drink_window_source?: string | null;
};

export type Score = {
  id: string;
  vintage_id: string;
  source: string;
  source_detail: string | null;
  raw_value: string;
  value_low: number | null;
  value_high: number | null;
  is_plus: boolean;
  is_barrel_sample: boolean;
  scale_max: number;
  reviewed_on: string | null;
  drink_from: number | null;
  drink_to: number | null;
  url: string | null;
};

export type Accolade = {
  id: string;
  vintage_id: string;
  raw_text: string;
  publication: string | null;
  title: string | null;
  rank: number | null;
  year: number | null;
};

export type Maturity = 'too_young' | 'approaching' | 'ready' | 'peak' | 'declining' | 'past_it';

/** The user's own note (tasting_notes). rating is out of 100; the app shows stars (20 per star). */
export type TastingNote = {
  id: string;
  account_id: string;
  vintage_id: string;
  inventory_event_id: string | null;
  /** Empty for an old CellarTracker score with no date. */
  tasted_on: string | null;
  rating: number | null;
  /** Thumbs up (true) or down (false); added later, so may be missing. */
  liked?: boolean | null;
  /** 'app' or 'cellartracker' (the owner's own old notes); may be missing. */
  source?: string;
  maturity: Maturity | null;
  notes: string | null;
  food_pairing: string | null;
  occasion: string | null;
  would_buy_again: boolean | null;
  created_at: string;
};

/** "all" or a cellar id. */
export type CellarFilter = string;
export const ALL_CELLARS = 'all';

export type SortKey = 'ready' | 'score' | 'region';

/** One line in the Cellar list: a wine + vintage, summed over its holdings. */
export type CellarItem = {
  vintageId: string;
  wineId: string;
  wineName: string;
  vintage: number | null;
  country: string | null;
  region: string | null;
  subRegion: string | null;
  appellation: string | null;
  colour: string | null;
  /** light / medium / full, when known. */
  body: string | null;
  grapes: string[];
  producer: string | null;
  bottles: number;
  magnums: number;
  otherSizes: number;
  onOrder: number;
  cellarNames: string[];
  score: number | null;
  scoreText: string | null;
  drinkFrom: number | null;
  drinkTo: number | null;
};

export type Totals = { wines: number; bottles: number; magnums: number; onOrder: number };

const MAGNUM_ML = 1500;

/** Holdings in the chosen cellar(s), grouped by vintage. Fully drunk lines are left out. */
export function groupInventory(
  rows: InventoryRow[],
  filter: CellarFilter,
  bestScores: Map<string, Score>,
): CellarItem[] {
  const byVintage = new Map<string, CellarItem>();
  for (const r of rows) {
    if (filter !== ALL_CELLARS && r.cellar_id !== filter) continue;
    if (r.quantity === 0 && r.quantity_on_order === 0) continue;
    let item = byVintage.get(r.vintage_id);
    if (!item) {
      const best = bestScores.get(r.vintage_id) ?? null;
      const window = drinkWindow(r.drink_from, r.drink_to, best);
      item = {
        vintageId: r.vintage_id,
        wineId: r.wine_id,
        wineName: r.wine_name,
        vintage: r.vintage,
        country: r.country,
        region: r.region,
        subRegion: r.sub_region ?? null,
        appellation: r.appellation,
        colour: r.colour,
        body: r.body ?? null,
        grapes: r.grapes ?? [],
        producer: r.producer,
        bottles: 0,
        magnums: 0,
        otherSizes: 0,
        onOrder: 0,
        cellarNames: [],
        score: best ? scoreValue(best) : null,
        scoreText: best ? scoreLabel(best.raw_value) : null,
        drinkFrom: window.from,
        drinkTo: window.to,
      };
      byVintage.set(r.vintage_id, item);
    }
    item.bottles += r.quantity;
    item.onOrder += r.quantity_on_order;
    if (r.bottle_size_ml === MAGNUM_ML) item.magnums += r.quantity;
    else if (r.bottle_size_ml !== 750) item.otherSizes += r.quantity;
    if (!item.cellarNames.includes(r.cellar_name)) item.cellarNames.push(r.cellar_name);
  }
  return [...byVintage.values()];
}

export function totals(items: CellarItem[]): Totals {
  return items.reduce<Totals>(
    (t, i) => ({
      wines: t.wines + 1,
      bottles: t.bottles + i.bottles,
      magnums: t.magnums + i.magnums,
      onOrder: t.onOrder + i.onOrder,
    }),
    { wines: 0, bottles: 0, magnums: 0, onOrder: 0 },
  );
}

/** Lower-case and strip accents, so "cote rotie" finds "Côte-Rôtie". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-’']/g, ' ');
}

/** Every word typed must appear somewhere in the wine's name, year, place or cellar. */
export function search(items: CellarItem[], query: string): CellarItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((i) => {
    const haystack = fold(
      [
        i.wineName,
        i.vintage ?? 'NV',
        i.country,
        i.region,
        i.subRegion,
        i.appellation,
        i.colour,
        ...i.cellarNames,
      ]
        .filter(Boolean)
        .join(' '),
    );
    return words.every((w) => haystack.includes(w));
  });
}

const byName = (a: CellarItem, b: CellarItem) =>
  a.wineName.localeCompare(b.wineName) || (a.vintage ?? 0) - (b.vintage ?? 0);

export function sortItems(items: CellarItem[], key: SortKey, year: number): CellarItem[] {
  const out = [...items];
  if (key === 'score') {
    out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || byName(a, b));
  } else if (key === 'region') {
    const place = (i: CellarItem) =>
      [i.country ?? '~', i.region ?? '~', i.subRegion ?? '~', i.appellation ?? '~'].join('|');
    out.sort((a, b) => place(a).localeCompare(place(b)) || byName(a, b));
  } else {
    out.sort((a, b) => readyRank(a, year) - readyRank(b, year) || byName(a, b));
  }
  return out;
}

/**
 * Lower = drink sooner. Wines with a known window come first: those near the
 * end of their window, then those inside it, then too young. Until windows
 * are filled in, older vintages come first as a rough guide.
 */
function readyRank(i: CellarItem, year: number): number {
  const r = ripeness(i.drinkFrom, i.drinkTo, year);
  switch (r.state) {
    case 'past':
      return 0 + (i.drinkTo ?? 0) / 1e4;
    case 'soon':
      return 1;
    case 'ready':
      return 2 + (i.drinkTo ?? 0) / 1e4;
    case 'young':
      return 4 + (i.drinkFrom ?? 0) / 1e4;
    default:
      return 3 + (i.vintage ?? year) / 1e4;
  }
}

// Scores --------------------------------------------------------------------

/** A score on a 100-point scale. "92-94" counts as 93; "94+" as 94.5. */
export function scoreValue(s: Score): number | null {
  if (s.value_low == null) return null;
  const mid =
    s.value_high != null ? (Number(s.value_low) + Number(s.value_high)) / 2 : Number(s.value_low);
  const plus = s.is_plus ? 0.5 : 0;
  return ((mid + plus) / s.scale_max) * 100;
}

/** The highest score per vintage. */
export function bestScoreByVintage(scores: Score[]): Map<string, Score> {
  const best = new Map<string, Score>();
  for (const s of scores) {
    const current = best.get(s.vintage_id);
    if (!current || (scoreValue(s) ?? -1) > (scoreValue(current) ?? -1)) best.set(s.vintage_id, s);
  }
  return best;
}

const SOURCE_NAMES: Record<string, string> = {
  unknown: 'Score',
  wine_advocate: 'Wine Advocate',
  vinous: 'Vinous',
  cellartracker: 'CellarTracker',
  wine_spectator: 'Wine Spectator',
  jancis_robinson: 'Jancis Robinson',
  james_suckling: 'James Suckling',
  jeb_dunnuck: 'Jeb Dunnuck',
  decanter: 'Decanter',
  burghound: 'Burghound',
};

export function sourceName(s: Score): string {
  if (s.source === 'other') return s.source_detail || 'Other';
  return SOURCE_NAMES[s.source] ?? s.source;
}

// Drinking window and ripeness -----------------------------------------------

/** The window the app uses: the vintage's own, else the best score's critic window. */
export function drinkWindow(
  from: number | null,
  to: number | null,
  best: Score | null,
): { from: number | null; to: number | null } {
  if (from != null || to != null) return { from, to };
  if (best && (best.drink_from != null || best.drink_to != null)) {
    return { from: best.drink_from, to: best.drink_to };
  }
  return { from: null, to: null };
}

export type RipenessState = 'unknown' | 'young' | 'ready' | 'soon' | 'past';

export type Ripeness = {
  state: RipenessState;
  label: string;
  /** 0..1 positions on the bar, or null when the window is unknown. */
  windowStart: number | null;
  windowEnd: number | null;
  marker: number | null;
  /** Years at the ends of the bar, for captions. */
  barFrom: number | null;
  barTo: number | null;
};

export function ripeness(from: number | null, to: number | null, year: number): Ripeness {
  if (from == null && to == null) {
    return {
      state: 'unknown',
      label: 'Drinking window not known yet',
      windowStart: null,
      windowEnd: null,
      marker: null,
      barFrom: null,
      barTo: null,
    };
  }
  const start = from ?? to!;
  const end = to ?? from! + 10;
  // The bar runs from a few years before the window to a few years after,
  // stretched if needed so "now" always fits on it.
  const barFrom = Math.min(start - 3, year);
  const barTo = Math.max(end + 3, year + 1);
  const span = Math.max(barTo - barFrom, 1);
  const pos = (y: number) => (y - barFrom) / span;

  let state: RipenessState;
  let label: string;
  if (year < start) {
    state = 'young';
    label = `Too young. Opens ${start}`;
  } else if (to != null && year > end) {
    state = 'past';
    label = `Past its window (ended ${end})`;
  } else if (to != null && end - year <= 1) {
    state = 'soon';
    label = `Drink soon. Window ends ${end}`;
  } else {
    state = 'ready';
    label = to != null ? `Ready now. Drink by ${end}` : `Ready now (from ${start})`;
  }
  return {
    state,
    label,
    windowStart: pos(start),
    windowEnd: pos(end),
    marker: pos(year + 0.5),
    barFrom,
    barTo,
  };
}

// Formatting ----------------------------------------------------------------

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** "5 bottles (2 magnums) · 3 on order". Magnums are counted in the bottles. */
export function countsLine(i: Pick<CellarItem, 'bottles' | 'magnums' | 'onOrder'>): string {
  const parts: string[] = [];
  if (i.magnums > 0 && i.magnums === i.bottles) parts.push(plural(i.magnums, 'magnum'));
  else if (i.magnums > 0)
    parts.push(`${plural(i.bottles, 'bottle')} (${plural(i.magnums, 'magnum')})`);
  else if (i.bottles > 0 || i.onOrder === 0) parts.push(plural(i.bottles, 'bottle'));
  if (i.onOrder > 0) parts.push(`${i.onOrder} on order`);
  return parts.join(' · ');
}

export function placeLine(i: {
  appellation: string | null;
  subRegion?: string | null;
  region: string | null;
  country: string | null;
}): string {
  const parts = [i.appellation, i.subRegion, i.region, i.country].filter(
    (p, idx, all): p is string => !!p && all.indexOf(p) === idx,
  );
  return parts.join(', ');
}

export function formatPrice(amount: number | null, currency: string | null): string | null {
  if (amount == null || !currency) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

/** A score as shown: decimals rounded to whole points ("93.75" → "94", "92.5-94" → "93-94"). */
export function scoreLabel(raw: string): string {
  return raw.replace(/\d+\.\d+/g, (n) => String(Math.round(Number(n))));
}
