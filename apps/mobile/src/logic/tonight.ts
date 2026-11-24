/**
 * Tonight: which bottles to open now. Pure logic (no React, no Supabase), so
 * it runs in plain Node tests.
 *
 * A bottle's place in the list comes from, in order of weight:
 *  1. Maturity: how far into its drinking window it is (ending soon ranks
 *     highest, too young is left out unless the ask names the wine, when it
 *     is listed last and marked as not ready). The blended review's maturity call
 *     ("at its peak", "declining") overrides the window when there is one.
 *  2. Food: what the ask mentions ("lamb", "oysters") favours the right
 *     colour, body, grapes and regions.
 *  3. Quality: the best score.
 *  4. Preference: wines the owner rated well before, and how well the bottle
 *     fits their palate profile (logic/palate.ts). "Surprise me" turns that
 *     around. A wine they gave a thumbs down drops down the list.
 */

import { ageNudge, palateFit, palateWeight, type PalateProfile } from './palate.ts';
import {
  fold,
  placeLine,
  ripeness,
  type CellarItem,
  type Maturity,
  type TastingNote,
} from './cellar.ts';

export type StyleColour = 'red' | 'white' | 'rose' | 'sparkling';
export type StyleBody = 'light' | 'medium' | 'full';

export const COLOUR_CHIPS: { key: StyleColour; label: string; plural: string }[] = [
  { key: 'red', label: 'Red', plural: 'reds' },
  { key: 'white', label: 'White', plural: 'whites' },
  { key: 'rose', label: 'Rosé', plural: 'rosés' },
  { key: 'sparkling', label: 'Sparkling', plural: 'sparkling wines' },
];

export const BODY_CHIPS: { key: StyleBody; label: string; short: string }[] = [
  { key: 'light', label: 'Light', short: 'Light' },
  { key: 'medium', label: 'Medium', short: 'Medium' },
  { key: 'full', label: 'Full-bodied', short: 'Full' },
];

// Food ------------------------------------------------------------------------

export type Pairing = {
  /** What we show: "lamb". */
  dish: string;
  /** Best colour first. */
  colours: StyleColour[];
  bodies?: StyleBody[];
  /** Folded grape names that suit it. */
  grapes: string[];
  /** Folded place words (region / appellation) that suit it. */
  places: string[];
};

/**
 * Classic pairings, kept deliberately short and mainstream. Words are folded
 * (lower case, no accents) and matched as whole words or their plurals.
 */
const FOODS: { words: string[]; pairing: Omit<Pairing, 'dish'> }[] = [
  {
    words: ['steak', 'beef', 'ribeye', 'rib eye', 'filet', 'prime rib', 'brisket', 'short rib'],
    pairing: {
      colours: ['red'],
      bodies: ['full'],
      grapes: ['cabernet sauvignon', 'cabernet', 'malbec', 'syrah', 'shiraz', 'merlot', 'nebbiolo'],
      places: ['napa', 'bordeaux', 'pauillac', 'margaux', 'saint julien', 'barolo', 'mendoza'],
    },
  },
  {
    words: ['lamb', 'mutton'],
    pairing: {
      colours: ['red'],
      bodies: ['full', 'medium'],
      grapes: ['syrah', 'cabernet sauvignon', 'grenache', 'tempranillo', 'mourvedre'],
      places: ['rhone', 'cote rotie', 'hermitage', 'rioja', 'bordeaux', 'pauillac'],
    },
  },
  {
    words: ['venison', 'game', 'boar', 'elk', 'wild boar'],
    pairing: {
      colours: ['red'],
      bodies: ['full', 'medium'],
      grapes: ['syrah', 'nebbiolo', 'pinot noir', 'mourvedre'],
      places: ['rhone', 'barolo', 'barbaresco', 'burgundy', 'bourgogne'],
    },
  },
  {
    words: ['duck', 'goose', 'quail', 'pigeon', 'squab'],
    pairing: {
      colours: ['red'],
      bodies: ['medium', 'light'],
      grapes: ['pinot noir', 'nebbiolo', 'grenache'],
      places: ['burgundy', 'bourgogne', 'willamette', 'dundee', 'oregon', 'sonoma'],
    },
  },
  {
    words: ['pork', 'ham', 'sausage', 'bacon', 'charcuterie'],
    pairing: {
      colours: ['red', 'white', 'rose'],
      bodies: ['medium', 'light'],
      grapes: ['pinot noir', 'grenache', 'gamay', 'riesling', 'chenin blanc', 'barbera'],
      places: ['burgundy', 'beaujolais', 'oregon', 'alsace'],
    },
  },
  {
    words: ['chicken', 'turkey', 'poultry', 'thanksgiving'],
    pairing: {
      colours: ['white', 'red'],
      bodies: ['medium', 'light'],
      grapes: ['chardonnay', 'pinot noir', 'gamay', 'chenin blanc'],
      places: ['burgundy', 'bourgogne', 'oregon', 'willamette', 'beaujolais'],
    },
  },
  {
    words: ['burger', 'bbq', 'barbecue', 'ribs'],
    pairing: {
      colours: ['red'],
      bodies: ['full', 'medium'],
      grapes: ['zinfandel', 'syrah', 'grenache', 'malbec', 'petite sirah'],
      places: ['paso robles', 'sonoma', 'rhone', 'chateauneuf'],
    },
  },
  {
    words: ['pizza', 'pasta', 'lasagna', 'bolognese', 'ragu', 'tomato', 'tomatoes'],
    pairing: {
      colours: ['red'],
      bodies: ['medium'],
      grapes: ['sangiovese', 'barbera', 'nebbiolo', 'montepulciano', 'aglianico'],
      places: ['tuscany', 'toscana', 'chianti', 'brunello', 'montalcino', 'piedmont', 'piemonte'],
    },
  },
  {
    words: ['mushroom', 'mushrooms', 'truffle', 'truffles', 'risotto'],
    pairing: {
      colours: ['red', 'white'],
      bodies: ['medium'],
      grapes: ['pinot noir', 'nebbiolo', 'chardonnay'],
      places: ['burgundy', 'bourgogne', 'barolo', 'barbaresco', 'oregon'],
    },
  },
  {
    words: ['salmon', 'tuna', 'trout'],
    pairing: {
      colours: ['red', 'white', 'rose'],
      bodies: ['light', 'medium'],
      grapes: ['pinot noir', 'chardonnay', 'gamay'],
      places: ['oregon', 'willamette', 'dundee', 'burgundy', 'bourgogne'],
    },
  },
  {
    words: ['lobster', 'crab', 'scallop', 'scallops', 'halibut', 'cod', 'sole', 'butter'],
    pairing: {
      colours: ['white', 'sparkling'],
      bodies: ['medium', 'full'],
      grapes: ['chardonnay', 'chenin blanc', 'viognier'],
      places: ['burgundy', 'bourgogne', 'meursault', 'chablis', 'puligny', 'sonoma'],
    },
  },
  {
    words: [
      'fish',
      'seafood',
      'oyster',
      'oysters',
      'shellfish',
      'shrimp',
      'prawns',
      'clams',
      'mussels',
      'ceviche',
      'sushi',
      'sashimi',
    ],
    pairing: {
      colours: ['white', 'sparkling', 'rose'],
      bodies: ['light', 'medium'],
      grapes: ['sauvignon blanc', 'chardonnay', 'riesling', 'albarino', 'chenin blanc'],
      places: ['chablis', 'sancerre', 'champagne', 'loire', 'muscadet'],
    },
  },
  {
    words: [
      'spicy',
      'thai',
      'indian',
      'curry',
      'szechuan',
      'sichuan',
      'chinese',
      'mexican',
      'tacos',
    ],
    pairing: {
      colours: ['white', 'rose', 'red'],
      bodies: ['light', 'medium'],
      grapes: ['riesling', 'gewurztraminer', 'gamay', 'grenache', 'zinfandel'],
      places: ['alsace', 'mosel', 'beaujolais'],
    },
  },
  {
    words: ['salad', 'vegetables', 'veggie', 'vegetarian', 'goat cheese', 'asparagus'],
    pairing: {
      colours: ['white', 'rose'],
      bodies: ['light', 'medium'],
      grapes: ['sauvignon blanc', 'chenin blanc', 'gruner veltliner'],
      places: ['sancerre', 'loire', 'provence'],
    },
  },
  {
    words: ['cheese', 'cheeses'],
    pairing: {
      colours: ['red', 'white'],
      bodies: ['full', 'medium'],
      grapes: ['cabernet sauvignon', 'nebbiolo', 'syrah', 'chardonnay'],
      places: ['bordeaux', 'barolo', 'rhone', 'burgundy'],
    },
  },
  {
    words: ['celebration', 'celebrate', 'aperitif', 'appetizers', 'caviar', 'fried'],
    pairing: {
      colours: ['sparkling', 'white'],
      bodies: ['light', 'medium'],
      grapes: ['chardonnay', 'pinot noir'],
      places: ['champagne'],
    },
  },
];

// Reading the ask -------------------------------------------------------------

export type Ask = {
  colour: StyleColour | null;
  body: StyleBody | null;
  foods: Pairing[];
  /** Words left over, used to look for a wine, region or year by name. */
  words: string[];
  /** "Surprise me": step outside the owner's usual palate. */
  surprise?: boolean;
};

const COLOUR_WORDS: Record<string, StyleColour> = {
  red: 'red',
  reds: 'red',
  white: 'white',
  whites: 'white',
  rose: 'rose',
  roses: 'rose',
  pink: 'rose',
  sparkling: 'sparkling',
  bubbles: 'sparkling',
  bubbly: 'sparkling',
  fizz: 'sparkling',
  champagne: 'sparkling',
};

/** "Italian" means wines from Italy: the word the cellar's data uses. */
const PLACE_WORDS: Record<string, string> = {
  italian: 'italy',
  italia: 'italy',
  french: 'france',
  spanish: 'spain',
  american: 'usa',
  californian: 'california',
  australian: 'australia',
  german: 'germany',
  austrian: 'austria',
  portuguese: 'portugal',
  argentinian: 'argentina',
  argentine: 'argentina',
  chilean: 'chile',
  burgundian: 'burgundy',
  tuscan: 'tuscany',
};

const BODY_WORDS: Record<string, StyleBody> = {
  light: 'light',
  lighter: 'light',
  delicate: 'light',
  medium: 'medium',
  full: 'full',
  fuller: 'full',
  big: 'full',
  bold: 'full',
  heavy: 'full',
  rich: 'full',
};

const STOP = new Set(
  `a an and are any as at be best bodied body bottle bottles can could dinner do drink drinking eat
  eating for from go goes good great have having i im i'm in is it like lunch make making maybe me mood
  my nice now of on open or pair pairs pairing please ready serve serving should some something
  that the to tonight wine wines want we what which will with would you your grilled roast roasted
  braised baked seared cooking cook dish dishes food friends guests night evening weekend
  special occasion glass little bit not too very really quite tonights well nicely perfect
  perfectly match matches matching suggest suggestion recommend recommendation recommendations
  pick choose need looking look find one two couple great lovely tasty also maybe idea ideas
  there this these those them our us its than then just`.split(/\s+/),
);

function tokens(text: string): string[] {
  return fold(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Reads a typed or spoken ask: "lamb chops, something full-bodied". */
export function parseAsk(text: string): Ask {
  const folded = ` ${tokens(text).join(' ')} `;
  const foods: Pairing[] = [];
  const used = new Set<string>();
  for (const f of FOODS) {
    const word = f.words.find((w) => folded.includes(` ${w} `) || folded.includes(` ${w}s `));
    const hit = word && !folded.includes(` ${word} `) ? `${word}s` : word;
    if (word && hit) {
      foods.push({ dish: hit, ...f.pairing });
      for (const part of word.split(' ')) used.add(part);
    }
  }

  let colour: StyleColour | null = null;
  let body: StyleBody | null = null;
  const words: string[] = [];
  let surprise = false;
  for (const w of tokens(text)) {
    if (/^surpris/.test(w)) {
      surprise = true;
      continue;
    }
    if (used.has(w) || used.has(w.replace(/s$/, ''))) continue;
    if (COLOUR_WORDS[w]) {
      colour = colour ?? COLOUR_WORDS[w];
      continue;
    }
    if (BODY_WORDS[w]) {
      body = body ?? BODY_WORDS[w];
      continue;
    }
    if (STOP.has(w) || w.length < 2) continue;
    words.push(PLACE_WORDS[w] ?? w);
  }
  return { colour, body, foods, words, surprise };
}

// Ranking ---------------------------------------------------------------------

export type ReadyState = 'peak' | 'ready' | 'soon' | 'past' | 'young' | 'unknown';

export type Readiness = {
  /** 0..1, higher = better to open now. */
  fit: number;
  state: ReadyState;
  label: string;
  /** Too young: left off Tonight, unless the ask names the wine (then listed last). */
  excluded: boolean;
};

/** How ready a wine is tonight, from its window and the latest maturity call. */
export function readiness(
  from: number | null,
  to: number | null,
  year: number,
  maturity: Maturity | null = null,
): Readiness {
  if (maturity === 'too_young') {
    return { fit: 0, state: 'young', label: 'Not ready yet', excluded: true };
  }
  if (maturity === 'past_it') {
    return { fit: 0.3, state: 'past', label: 'May be past its best', excluded: false };
  }
  if (maturity === 'declining') {
    return { fit: 1, state: 'soon', label: 'Drink soon', excluded: false };
  }

  const r = ripeness(from, to, year);
  if (r.state === 'young') {
    if (maturity === 'peak') return { fit: 0, state: 'ready', label: r.label, excluded: false };
    return { fit: 0, state: 'young', label: `Not ready yet. Opens ${from ?? to}`, excluded: true };
  }
  if (r.state === 'unknown') {
    if (maturity === 'peak')
      return { fit: 0.95, state: 'peak', label: 'At its peak', excluded: false };
    return { fit: 0.35, state: 'unknown', label: 'Window not known', excluded: false };
  }
  if (r.state === 'past') {
    const yearsPast = year - (to ?? year);
    return {
      fit: Math.max(0.25, 0.8 - 0.15 * yearsPast),
      state: 'past',
      label: 'Drink up: past its window',
      excluded: false,
    };
  }
  if (r.state === 'soon') return { fit: 1, state: 'soon', label: 'Drink soon', excluded: false };

  // Inside the window: further in = more ready, with the middle called the peak.
  const start = from ?? to!;
  const end = to ?? start + 10;
  const p = Math.min(Math.max((year - start) / Math.max(end - start, 1), 0), 1);
  if (maturity === 'peak' || (p >= 0.35 && p <= 0.85)) {
    return { fit: 0.85 + 0.05 * p, state: 'peak', label: 'At its peak', excluded: false };
  }
  return { fit: 0.65 + 0.2 * p, state: 'ready', label: 'Ready now', excluded: false };
}

export type TonightOptions = {
  year: number;
  colour: StyleColour | null;
  body: StyleBody | null;
  ask: Ask;
  /**
   * Every bottle in every cellar. A grape, place or name the ask mentions that
   * is not in this cellar but is in another still narrows the list (to nothing
   * here), and is reported in `elsewhere` rather than silently ignored.
   */
  everywhere?: CellarItem[];
  /** Latest maturity call per vintage, from the blended reviews. */
  maturity?: Map<string, Maturity>;
  /** The owner's own notes, for "you liked this before". */
  notes?: TastingNote[];
  /** The owner's palate profile: bottles that fit it move up. */
  palate?: PalateProfile | null;
};

export type Pick = {
  item: CellarItem;
  rank: number;
  ready: Readiness;
  /** Short reasons, most important first: "Goes with lamb", "You gave it 5 stars". */
  reasons: string[];
  /** The dish it suits, when the ask named one. */
  dish: string | null;
};

export type TonightResult = {
  picks: Pick[];
  /** Words in the ask that matched a wine, region or year (they narrow the list). */
  matchedWords: string[];
  /** Food was named but nothing suits it in the chosen colour; shown as a hint. */
  foodIgnored: boolean;
  /** Words the ask named that are not among these bottles, with the cellars that do have them. */
  elsewhere: { word: string; cellars: { name: string; wines: number }[] }[];
  /** The ask named something the Red/White/... or body buttons would hide, so they were not applied. */
  chipsSetAside: boolean;
  /** How many picks are too young to open: shown only because the ask named them, and listed last. */
  notReady: number;
};

function haystack(i: CellarItem): string {
  return fold(
    [
      i.wineName,
      i.vintage ?? 'NV',
      i.producer,
      i.country,
      i.region,
      i.subRegion,
      i.appellation,
      ...i.grapes,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/** The wine's own name and producer: what "named the wine" means. */
function nameHaystack(i: CellarItem): string {
  return fold([i.wineName, i.producer].filter(Boolean).join(' '));
}

/** True when some word in hay starts with w ("chard" finds "chardonnay", "well" misses "caldwell"). */
function hasWordStart(hay: string, w: string): boolean {
  return ` ${hay.replace(/[^a-z0-9]+/g, ' ')}`.includes(` ${w}`);
}

function hasWord(hay: string, phrase: string): boolean {
  return ` ${hay.replace(/[^a-z0-9]+/g, ' ')} `.includes(` ${phrase} `);
}

/** 0..1: how well a wine suits the dishes named. */
function foodFit(
  i: CellarItem,
  foods: Pairing[],
): { fit: number; dish: string | null; why: string | null } {
  let best = { fit: 0, dish: null as string | null, why: null as string | null };
  const hay = haystack(i);
  for (const f of foods) {
    const ci = f.colours.indexOf((i.colour ?? '') as StyleColour);
    if (ci < 0) continue;
    let fit = ci === 0 ? 0.45 : 0.35;
    if (f.bodies && i.body && f.bodies.includes(i.body as StyleBody)) fit += 0.15;
    const grape = f.grapes.find((g) => hasWord(hay, g));
    const place = f.places.find((p) => hasWord(hay, p));
    if (grape) fit += 0.3;
    if (place) fit += 0.2;
    fit = Math.min(fit, 1);
    if (fit > best.fit) best = { fit, dish: f.dish, why: `Goes with ${f.dish}` };
  }
  return best;
}

function scoreFit(score: number | null): number {
  if (score == null) return 0.4;
  return Math.min(Math.max((score - 86) / 11, 0), 1);
}

/** Average of the owner's ratings (0..100) per wine, any vintage. */
function ratingsByWine(notes: TastingNote[], items: CellarItem[]): Map<string, number> {
  const wineOf = new Map(items.map((i) => [i.vintageId, i.wineId]));
  const sums = new Map<string, { total: number; n: number }>();
  for (const n of notes) {
    if (n.rating == null) continue;
    const wine = wineOf.get(n.vintage_id);
    if (!wine) continue;
    const s = sums.get(wine) ?? { total: 0, n: 0 };
    s.total += n.rating;
    s.n += 1;
    sums.set(wine, s);
  }
  return new Map([...sums].map(([k, s]) => [k, s.total / s.n]));
}

/** The bottles to suggest tonight, best first. Only bottles in the cellar (not on order). */
export function recommend(items: CellarItem[], o: TonightOptions): TonightResult {
  let colour = o.colour ?? o.ask.colour;
  let body = o.body ?? o.ask.body;

  const inCellar = items.filter((i) => i.bottles > 0);
  const styled = (c: string | null, b: string | null) =>
    inCellar.filter((i) => (!c || i.colour === c) && (!b || i.body === b));
  let pool = styled(colour, body);

  // Names, grapes, places and years in the ask narrow the list. Words that
  // match nothing anywhere ("recommend", "nice") are ignored. A word that only
  // matches bottles hidden by the style buttons sets those buttons aside for
  // this question (the ask is more specific). A word that only matches bottles
  // in another cellar narrows the list to none here and is reported.
  const matchedWords: string[] = [];
  const elsewhere: TonightResult['elsewhere'] = [];
  let chipsSetAside = false;
  let named = false;
  if (o.ask.words.length > 0) {
    const hay = new Map(inCellar.map((i) => [i.vintageId, haystack(i)]));
    // Whole words or word starts, so "well" does not match "Caldwell".
    const hit = (i: CellarItem, w: string) => hasWordStart(hay.get(i.vintageId) ?? haystack(i), w);
    const has = (list: CellarItem[], w: string) => list.some((i) => hit(i, w));
    const unstyled = styled(o.ask.colour, o.ask.body);
    const others = (o.everywhere ?? []).filter((i) => i.bottles > 0);
    const here: string[] = [];
    for (const w of o.ask.words) {
      if (has(pool, w)) {
        here.push(w);
        continue;
      }
      if ((o.colour || o.body) && has(unstyled, w)) {
        here.push(w);
        chipsSetAside = true;
        continue;
      }
      const there = others.filter((i) => hasWordStart(haystack(i), w));
      if (there.length === 0) continue;
      matchedWords.push(w);
      const counts = new Map<string, number>();
      for (const i of there) {
        for (const c of i.cellarNames) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      elsewhere.push({
        word: w,
        cellars: [...counts].map(([name, wines]) => ({ name, wines })),
      });
    }
    if (chipsSetAside) {
      colour = o.ask.colour;
      body = o.ask.body;
      pool = styled(colour, body);
    }
    // Narrow word by word; a word that would leave nothing (two names that
    // never meet, like "chardonnay" and "barolo") is skipped, not fatal.
    for (const w of here) {
      const narrowed = pool.filter((i) => hit(i, w));
      if (narrowed.length > 0) {
        pool = narrowed;
        matchedWords.push(w);
        if (narrowed.some((i) => hasWordStart(nameHaystack(i), w))) named = true;
      }
    }
    // Something named lives only in another cellar: none here.
    if (elsewhere.length > 0) pool = [];
  }

  // Food named: keep to the colours that suit it, unless the owner chose a colour.
  const foods = o.ask.foods;
  let foodIgnored = false;
  if (foods.length > 0 && !colour) {
    const suits = pool.filter((i) =>
      foods.some((f) => f.colours.includes(i.colour as StyleColour)),
    );
    if (suits.length > 0) pool = suits;
    else foodIgnored = true;
  } else if (foods.length > 0 && colour) {
    foodIgnored = !foods.some((f) => f.colours.includes(colour));
  }

  const ratings = ratingsByWine(o.notes ?? [], items);
  const picks: Pick[] = [];
  for (const item of pool) {
    const ready = readiness(item.drinkFrom, item.drinkTo, o.year, o.maturity?.get(item.vintageId));
    // A wine asked for by name is always shown, even too young (last, marked).
    if (ready.excluded && !named) continue;
    const food = foods.length > 0 && !foodIgnored ? foodFit(item, foods) : null;
    const rating = ratings.get(item.wineId) ?? null;
    const pref = rating == null ? 0 : Math.min(Math.max((rating - 60) / 40, 0), 1);

    const taste = o.palate ? palateFit(item, o.palate) : null;
    const weight = o.palate ? palateWeight(o.palate, !!o.ask.surprise) : 0;

    const rank =
      (ready.excluded ? -10 : 0) +
      (taste ? weight * taste.fit + ageNudge(o.palate!, ready.state) : 0) +
      (taste?.notForMe && !named ? -0.25 : 0) +
      0.6 * ready.fit +
      0.2 * scoreFit(item.score) +
      (food ? 0.45 * food.fit : 0) +
      0.1 * pref +
      (0.02 * Math.min(item.bottles, 6)) / 6;

    const reasons: string[] = [];
    if (food?.why && food.fit >= 0.5) reasons.push(food.why);
    if (rating != null && rating >= 80) {
      reasons.push(`You gave it ${Math.round(rating / 20)} stars`);
    } else if (taste?.why && !o.ask.surprise) {
      reasons.push(taste.why);
    }
    picks.push({ item, rank, ready, reasons, dish: food?.dish ?? null });
  }
  picks.sort(
    (a, b) =>
      b.rank - a.rank ||
      a.item.wineName.localeCompare(b.item.wineName) ||
      (a.item.vintage ?? 0) - (b.item.vintage ?? 0),
  );
  const notReady = picks.filter((p) => p.ready.excluded).length;
  return { picks, matchedWords, foodIgnored, elsewhere, chipsSetAside, notReady };
}

/** "Full reds", "Whites", "Light", or "" when nothing is chosen. */
export function styleLine(colour: StyleColour | null, body: StyleBody | null): string {
  const c = COLOUR_CHIPS.find((x) => x.key === colour);
  const b = BODY_CHIPS.find((x) => x.key === body);
  if (c && b) return `${b.short} ${c.plural}`;
  if (c) return c.plural[0].toUpperCase() + c.plural.slice(1);
  if (b) return `${b.label} wines`;
  return '';
}

/** A pick as the sommelier (Claude) sees it: plain facts, no ids beyond the vintage. */
export function toCandidate(p: Pick): {
  id: string;
  name: string;
  vintage: number | null;
  place: string;
  colour: string | null;
  body: string | null;
  grapes: string[];
  window: string;
  ready: string;
  score: string | null;
  bottles: number;
} {
  const i = p.item;
  return {
    id: i.vintageId,
    name: i.wineName,
    vintage: i.vintage,
    place: placeLine(i),
    colour: i.colour,
    body: i.body,
    grapes: i.grapes,
    window: i.drinkFrom || i.drinkTo ? `${i.drinkFrom ?? ''}-${i.drinkTo ?? ''}` : '',
    ready: p.ready.label,
    score: i.scoreText,
    bottles: i.bottles,
  };
}
