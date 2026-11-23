/**
 * Pure helpers for Drink one and Add bottles: which holding to take a bottle
 * from, finding a wine from typed or spoken words, and reading a delivery
 * spreadsheet's rows. No React or Supabase, so it runs in Node tests.
 */
import type { InventoryRow } from './cellar';

// Drink one --------------------------------------------------------------------

export type DrinkChoice = {
  cellarId: string;
  cellarName: string;
  sizeMl: number;
  sizeLabel: string;
  bottles: number;
  /** The holding a bottle is taken from: the lot with the most bottles. */
  holding: InventoryRow;
};

/** Where a bottle of this vintage can come from: one choice per cellar and bottle size. */
export function drinkChoices(rows: InventoryRow[], cellarOrder: string[]): DrinkChoice[] {
  const byKey = new Map<string, DrinkChoice>();
  for (const r of rows) {
    if (r.quantity <= 0) continue;
    const key = `${r.cellar_id}|${r.bottle_size_ml}`;
    const c = byKey.get(key);
    if (!c) {
      byKey.set(key, {
        cellarId: r.cellar_id,
        cellarName: r.cellar_name,
        sizeMl: r.bottle_size_ml,
        sizeLabel: r.bottle_size_label,
        bottles: r.quantity,
        holding: r,
      });
    } else {
      c.bottles += r.quantity;
      if (r.quantity > c.holding.quantity) c.holding = r;
    }
  }
  const rank = (id: string) => {
    const i = cellarOrder.indexOf(id);
    return i < 0 ? 99 : i;
  };
  return [...byKey.values()].sort(
    (a, b) => rank(a.cellarId) - rank(b.cellarId) || a.sizeMl - b.sizeMl,
  );
}

/**
 * The choice to use straight away, or null when Dan has to pick. Prefers the
 * cellar he is looking at; a standard bottle over other sizes.
 */
export function defaultDrinkChoice(
  choices: DrinkChoice[],
  currentCellarId: string | null,
): DrinkChoice | null {
  const here = currentCellarId ? choices.filter((c) => c.cellarId === currentCellarId) : choices;
  const pool = here.length > 0 ? here : choices;
  const cellars = new Set(pool.map((c) => c.cellarId));
  if (cellars.size !== 1) return null;
  if (pool.length === 1) return pool[0];
  return null;
}

// Finding a wine ----------------------------------------------------------------

/** Lower case, no accents, no punctuation, "St" = "Saint", "Chateau" dropped. */
export function foldName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`.,()/-]/g, ' ')
    .replace(/\bste?\b/g, 'saint')
    .replace(/\b(chateau|domaine|dom)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type WineMatch = {
  wineId: string;
  name: string;
  place: string;
  country: string | null;
  region: string | null;
  appellation: string | null;
  vintages: number[];
};

/** Wines already in the account whose name (or place) contains every word typed. */
export function findWines(rows: InventoryRow[], query: string, limit = 6): WineMatch[] {
  const words = foldName(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const wines = new Map<string, WineMatch & { score: number }>();
  for (const r of rows) {
    let w = wines.get(r.wine_id);
    if (!w) {
      const name = foldName(r.wine_name);
      const hay = `${name} ${foldName([r.appellation, r.region, r.country].filter(Boolean).join(' '))}`;
      if (!words.every((x) => hay.includes(x))) continue;
      const score =
        (name === words.join(' ') ? 100 : 0) +
        (name.startsWith(words[0]) ? 10 : 0) +
        words.filter((x) => name.includes(x)).length;
      w = {
        wineId: r.wine_id,
        name: r.wine_name,
        place: [r.appellation, r.region, r.country].filter(Boolean).join(', '),
        country: r.country,
        region: r.region,
        appellation: r.appellation,
        vintages: [],
        score,
      };
      wines.set(r.wine_id, w);
    }
    if (r.vintage != null && !w.vintages.includes(r.vintage)) w.vintages.push(r.vintage);
  }
  return [...wines.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ score: _score, ...w }) => ({ ...w, vintages: w.vintages.sort((a, b) => b - a) }));
}

/** The wine whose folded name is exactly this one, if any (used for delivery matching). */
export function exactWine(rows: InventoryRow[], name: string): InventoryRow | null {
  const target = foldName(name);
  return rows.find((r) => foldName(r.wine_name) === target) ?? null;
}

// Spoken adds ----------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  case: 12,
  eighteen: 18,
  twenty: 20,
  'twenty four': 24,
};

export type SpokenAdd = {
  quantity: number | null;
  vintage: number | null;
  sizeMl: number | null;
  onOrder: boolean;
  /** What's left: words to look the wine up by. */
  query: string;
};

/**
 * Reads a sentence like "six bottles of 2019 Ridge Monte Bello, on order" or
 * "two magnums of Latour 2010". Anything it doesn't recognise is left in query.
 */
export function parseSpokenAdd(text: string): SpokenAdd {
  let t = ` ${text.toLowerCase().replace(/[,.!?]/g, ' ')} `;
  let onOrder = false;
  if (/\b(on order|ordered|pre ?order|future|futures|en primeur)\b/.test(t)) {
    onOrder = true;
    t = t.replace(/\b(on order|ordered|pre ?order|futures?|en primeur)\b/g, ' ');
  }
  let sizeMl: number | null = null;
  if (/\bmagnums?\b|\b1\.5 ?l(iters?|itres?)?\b/.test(t)) sizeMl = 1500;
  else if (/\bhalf bottles?\b|\bhalves\b|\b375\b/.test(t)) sizeMl = 375;
  else if (/\bdouble magnums?\b|\b3 ?l(iters?|itres?)?\b/.test(t)) sizeMl = 3000;

  let vintage: number | null = null;
  const year = t.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  if (year) {
    vintage = Number(year[1]);
    t = t.replace(year[0], ' ');
  }

  let quantity: number | null = null;
  const caseOf = t.match(/\b(a|one|two|three|\d+)\s+cases?\b/);
  const qty = t.match(
    /\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty)\s+(bottles?|magnums?|half bottles?|halves|btls?|double magnums?)\b/,
  );
  if (caseOf) {
    const n = /^\d+$/.test(caseOf[1]) ? Number(caseOf[1]) : NUMBER_WORDS[caseOf[1]];
    quantity = n * 12;
    t = t.replace(caseOf[0], ' ');
  } else if (qty) {
    quantity = /^\d+$/.test(qty[1]) ? Number(qty[1]) : NUMBER_WORDS[qty[1]];
    t = t.replace(qty[0], ' ');
  }

  const query = t
    .replace(
      /\b(add|added|adding|bottles?|magnums?|half|halves|double|of|the|to|in|into|my|cellar|please|and|btls?)\b/g,
      ' ',
    )
    .replace(/\b(la home|los angeles|oregon|paris)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { quantity, vintage, sizeMl, onOrder, query };
}

/** Which cellar a sentence mentions, by name. */
export function spokenCellar(text: string, cellars: { id: string; name: string }[]): string | null {
  const t = foldName(text);
  for (const c of cellars) {
    const n = foldName(c.name.replace(/\bhome\b/i, ''));
    if (n && t.includes(n)) return c.id;
  }
  if (/\blos angeles\b/.test(t)) return cellars.find((c) => /^la\b/i.test(c.name))?.id ?? null;
  return null;
}

// Scores ----------------------------------------------------------------------------

/** "94+" → 94 plus; "92-94" → 92..94; "17.5/20" is left as text only. */
export function parseScore(raw: string): {
  raw: string;
  low: number | null;
  high: number | null;
  plus: boolean;
} | null {
  const s = raw.trim();
  if (!s) return null;
  const range = s.match(/^(\d{2,3})\s*[-–]\s*(\d{2,3})\+?$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { raw: s, low: Math.min(a, b), high: Math.max(a, b), plus: false };
  }
  const single = s.match(/^(\d{2,3})(\+)?$/);
  if (single && Number(single[1]) <= 100)
    return { raw: s, low: Number(single[1]), high: null, plus: !!single[2] };
  return { raw: s, low: null, high: null, plus: false };
}
