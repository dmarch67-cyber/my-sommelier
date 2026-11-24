// The owner's palate profile, worked out from what is already in the app:
//  1. What they buy and, above all, what they drink (bottles drunk count most).
//  2. Their own scores, thumbs up/down and notes (including old CellarTracker ones).
//  3. A short taste quiz, which fills in what the cellar can't say.
// Lines they say "not really" to are left out. Plain TypeScript, no React,
// so it is easy to test.

import type { CellarItem, InventoryRow, TastingNote } from './cellar.ts';
import type { ReadyState } from './tonight.ts';

// The quiz --------------------------------------------------------------------

export type QuizKey =
  | 'colour'
  | 'body'
  | 'world'
  | 'redStyle'
  | 'fruit'
  | 'tannin'
  | 'acidity'
  | 'oak'
  | 'age'
  | 'adventure';

export type QuizAnswers = Partial<Record<QuizKey, string>>;

export type QuizQuestion = {
  key: QuizKey;
  question: string;
  /** says: how the answer reads in the summary ("firm structure"); the label when absent. */
  options: { key: string; label: string; says?: string }[];
};

export const QUIZ: QuizQuestion[] = [
  {
    key: 'colour',
    question: 'Most nights, what do you reach for?',
    options: [
      { key: 'red', label: 'Red' },
      { key: 'white', label: 'White' },
      { key: 'either', label: 'Either, it depends' },
    ],
  },
  {
    key: 'body',
    question: 'How full do you like a wine?',
    options: [
      { key: 'light', label: 'Light and fresh' },
      { key: 'medium', label: 'In the middle' },
      { key: 'full', label: 'Big and full' },
      { key: 'any', label: 'No preference' },
    ],
  },
  {
    key: 'world',
    question: 'Old World or New World?',
    options: [
      { key: 'old', label: 'Old World (France, Italy, Spain)' },
      { key: 'new', label: 'New World (California, Oregon, Australia)' },
      { key: 'both', label: 'Both equally' },
    ],
  },
  {
    key: 'redStyle',
    question: 'Your favourite kind of red?',
    options: [
      { key: 'cabernet', label: 'Cabernet and Bordeaux blends' },
      { key: 'pinot', label: 'Pinot Noir and Burgundy' },
      { key: 'rhone', label: 'Grenache, Syrah and Rhône blends' },
      { key: 'spain', label: 'Tempranillo and Spanish reds' },
      { key: 'italy', label: 'Sangiovese and Nebbiolo' },
    ],
  },
  {
    key: 'fruit',
    question: 'Ripe and fruity, or savoury and earthy?',
    options: [
      { key: 'ripe', label: 'Ripe and fruity', says: 'ripe, fruity wines' },
      { key: 'balanced', label: 'A bit of both', says: 'fruit with some savoury notes' },
      { key: 'savoury', label: 'Savoury and earthy', says: 'savoury, earthy wines' },
    ],
  },
  {
    key: 'tannin',
    question: 'How do you feel about tannin (the drying grip)?',
    options: [
      { key: 'soft', label: 'Soft and smooth', says: 'soft tannins' },
      { key: 'some', label: 'Some grip is good', says: 'some grip' },
      { key: 'firm', label: 'I like firm structure', says: 'firm structure' },
    ],
  },
  {
    key: 'acidity',
    question: 'Bright and zesty, or round and soft?',
    options: [
      { key: 'bright', label: 'Bright and zesty', says: 'bright acidity' },
      { key: 'any', label: 'No preference' },
      { key: 'round', label: 'Round and soft', says: 'round, soft wines' },
    ],
  },
  {
    key: 'oak',
    question: 'Oak (vanilla, toast, spice)?',
    options: [
      { key: 'little', label: 'Little or none', says: 'little oak' },
      { key: 'some', label: 'Some is nice', says: 'some oak' },
      { key: 'lots', label: 'Rich and oaky is great', says: 'rich oak' },
    ],
  },
  {
    key: 'age',
    question: 'Young and vibrant, or mature?',
    options: [
      { key: 'young', label: 'Young and vibrant', says: 'young, vibrant bottles' },
      { key: 'middle', label: 'In the middle', says: 'bottles in mid-life' },
      { key: 'mature', label: 'Mature, with age on it', says: 'mature bottles' },
    ],
  },
  {
    key: 'adventure',
    question: 'How adventurous should suggestions be?',
    options: [
      { key: 'favourites', label: 'Stick to what I love' },
      { key: 'mostly', label: 'Mostly favourites, a surprise now and then' },
      { key: 'surprise', label: 'Surprise me often' },
    ],
  },
];

function answerLabel(q: QuizKey, a: string | undefined): string | null {
  const o = QUIZ.find((x) => x.key === q)?.options.find((x) => x.key === a);
  return o ? (o.says ?? o.label) : null;
}

// What grapes are usually like ------------------------------------------------
// 0 low .. 2 high; fruit 0 savoury .. 2 ripe. A rough guide only: it nudges
// the ranking, and the sommelier (Claude) sees the profile in words.

type Traits = { tannin: number; acid: number; fruit: number; oak: number };

const GRAPE_TRAITS: Record<string, Traits> = {
  'cabernet sauvignon': { tannin: 2, acid: 1, fruit: 1.2, oak: 1.6 },
  merlot: { tannin: 1, acid: 0.8, fruit: 1.5, oak: 1.2 },
  'cabernet franc': { tannin: 1.3, acid: 1.3, fruit: 0.8, oak: 1 },
  'petit verdot': { tannin: 2, acid: 1, fruit: 1.3, oak: 1.4 },
  malbec: { tannin: 1.4, acid: 0.8, fruit: 1.7, oak: 1.2 },
  grenache: { tannin: 0.8, acid: 0.7, fruit: 1.8, oak: 0.8 },
  garnacha: { tannin: 0.8, acid: 0.7, fruit: 1.8, oak: 0.8 },
  syrah: { tannin: 1.5, acid: 1, fruit: 1.3, oak: 1.2 },
  shiraz: { tannin: 1.5, acid: 0.8, fruit: 1.8, oak: 1.4 },
  mourvèdre: { tannin: 1.8, acid: 0.9, fruit: 0.8, oak: 1 },
  monastrell: { tannin: 1.7, acid: 0.8, fruit: 1.4, oak: 1.2 },
  'pinot noir': { tannin: 0.5, acid: 1.6, fruit: 1, oak: 0.8 },
  tempranillo: { tannin: 1.5, acid: 1.1, fruit: 1, oak: 1.6 },
  'tinto fino': { tannin: 1.6, acid: 1.1, fruit: 1.1, oak: 1.6 },
  sangiovese: { tannin: 1.4, acid: 1.8, fruit: 0.6, oak: 0.8 },
  nebbiolo: { tannin: 2, acid: 1.8, fruit: 0.4, oak: 0.8 },
  zinfandel: { tannin: 1, acid: 0.8, fruit: 2, oak: 1.2 },
  carignan: { tannin: 1.4, acid: 1.2, fruit: 1, oak: 0.8 },
  chardonnay: { tannin: 0, acid: 1.2, fruit: 1.2, oak: 1.4 },
  'sauvignon blanc': { tannin: 0, acid: 1.8, fruit: 1, oak: 0.3 },
  riesling: { tannin: 0, acid: 2, fruit: 1.2, oak: 0 },
  'chenin blanc': { tannin: 0, acid: 1.8, fruit: 1, oak: 0.5 },
  viognier: { tannin: 0, acid: 0.6, fruit: 1.8, oak: 0.8 },
  'pinot gris': { tannin: 0, acid: 1, fruit: 1.2, oak: 0.3 },
  sémillon: { tannin: 0, acid: 1, fruit: 1, oak: 1 },
};

const OLD_WORLD = new Set([
  'france',
  'italy',
  'spain',
  'portugal',
  'germany',
  'austria',
  'greece',
  'hungary',
  'switzerland',
]);

function world(country: string | null): 'old' | 'new' | null {
  if (!country) return null;
  return OLD_WORLD.has(country.toLowerCase()) ? 'old' : 'new';
}

function traitsOf(i: Pick<CellarItem, 'grapes' | 'country'>): Traits | null {
  const known = i.grapes.map((g) => GRAPE_TRAITS[g.toLowerCase()]).filter(Boolean);
  if (known.length === 0) return null;
  const avg = (k: keyof Traits) => known.reduce((s, t) => s + t[k], 0) / known.length;
  // New World wines tend to be riper and oakier.
  const nw = world(i.country) === 'new' ? 1 : 0;
  return {
    tannin: avg('tannin'),
    acid: avg('acid') - 0.2 * nw,
    fruit: Math.min(avg('fruit') + 0.4 * nw, 2),
    oak: Math.min(avg('oak') + 0.3 * nw, 2),
  };
}

const RED_STYLE_GRAPES: Record<string, string[]> = {
  cabernet: ['cabernet sauvignon', 'merlot', 'cabernet franc', 'petit verdot', 'malbec'],
  pinot: ['pinot noir'],
  rhone: ['grenache', 'garnacha', 'syrah', 'shiraz', 'mourvèdre', 'carignan'],
  spain: ['tempranillo', 'tinto fino', 'garnacha', 'monastrell'],
  italy: ['sangiovese', 'nebbiolo'],
};

// The profile -----------------------------------------------------------------

export type Affinity = {
  /** "grape:Merlot", "place:France|Bordeaux", "producer:Aalto": what "not really" stores. */
  key: string;
  label: string;
  /** 0..1, the strongest is 1. */
  value: number;
  bought: number;
  drunk: number;
};

export type ProfileLine = { key: string; text: string };

export type PalateProfile = {
  bottlesBought: number;
  bottlesDrunk: number;
  /** How many of the owner's own scores, thumbs and notes went in. */
  ownNotes: number;
  quizDone: boolean;
  quiz: QuizAnswers;
  notReally: Set<string>;
  grapes: Affinity[];
  places: Affinity[];
  /** Producers they open fastest (most of what they buy gets drunk). */
  favourites: Affinity[];
  /** Wines they rated highly or gave a thumbs up. */
  loved: string[];
  /** Wines they gave a thumbs down or a low score: their wine ids. */
  notForMe: Set<string>;
  notForMeNames: string[];
  /** The plain-English summary at the top of My palate. */
  headline: string;
  /** One line per thing they can say "not really" to. */
  lines: ProfileLine[];
  /** "From your quiz: ..." or null. */
  quizLine: string | null;
  style: { colour: string | null; body: string | null; share: number };
};

export type VintageDrinking = { vintage_id: string; bought: number; drunk: number };

export type PalateNote = Pick<TastingNote, 'vintage_id' | 'rating'> & {
  liked?: boolean | null;
  notes?: string | null;
};

type WineFacts = {
  wineId: string;
  name: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  colour: string | null;
  body: string | null;
  grapes: string[];
  bought: number;
  drunk: number;
  /** Own opinion: + loved, - not for them. */
  opinion: number;
};

/** How much one note says about liking the wine: up to +3 / down to -4. */
function noteSignal(n: PalateNote): number {
  if (n.liked === true) return 3;
  if (n.liked === false) return -4;
  if (n.rating == null) return 0;
  if (n.rating >= 93) return 3;
  if (n.rating >= 90) return 1.5;
  if (n.rating >= 85) return 0;
  return -3;
}

function placeKey(country: string | null, region: string | null): string | null {
  if (!country && !region) return null;
  return `${country ?? ''}|${region ?? ''}`;
}

function placeLabel(country: string | null, region: string | null): string {
  if (!region) return country ?? '';
  if (!country || country === 'USA' || country === 'France') return region;
  return `${region}, ${country}`;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const COLOUR_WORD: Record<string, string> = {
  red: 'reds',
  white: 'whites',
  rose: 'rosés',
  sparkling: 'sparkling wines',
};

/** Builds the profile. rows: every holding (including fully drunk ones). */
export function buildProfile(input: {
  rows: InventoryRow[];
  drinking: VintageDrinking[];
  notes: PalateNote[];
  quiz?: QuizAnswers | null;
  notReally?: string[] | null;
}): PalateProfile {
  const quiz = input.quiz ?? {};
  const notReally = new Set(input.notReally ?? []);
  const drinking = new Map(input.drinking.map((d) => [d.vintage_id, d]));

  // One entry per wine, any vintage.
  const wines = new Map<string, WineFacts>();
  const wineOfVintage = new Map<string, string>();
  const seenVintage = new Set<string>();
  for (const r of input.rows) {
    wineOfVintage.set(r.vintage_id, r.wine_id);
    const w: WineFacts = wines.get(r.wine_id) ?? {
      wineId: r.wine_id,
      name: r.wine_name,
      producer: r.producer,
      country: r.country,
      region: r.region,
      colour: r.colour,
      body: r.body ?? null,
      grapes: r.grapes ?? [],
      bought: 0,
      drunk: 0,
      opinion: 0,
    };
    wines.set(r.wine_id, w);
    if (seenVintage.has(r.vintage_id)) continue;
    seenVintage.add(r.vintage_id);
    const d = drinking.get(r.vintage_id);
    if (d) {
      w.bought += d.bought;
      w.drunk += d.drunk;
    }
  }
  // Fall back to the holdings when the drinking counts are missing.
  if (input.drinking.length === 0) {
    for (const r of input.rows) {
      const w = wines.get(r.wine_id);
      if (w) w.bought += r.quantity + r.quantity_on_order;
    }
  }

  let ownNotes = 0;
  for (const n of input.notes) {
    const w = wines.get(wineOfVintage.get(n.vintage_id) ?? '');
    if (!w) continue;
    const s = noteSignal(n);
    if (s !== 0 || n.liked != null || n.rating != null) ownNotes++;
    w.opinion += s;
  }

  // Drinking a bottle says the most; buying says something; own opinions on top.
  const signal = (w: WineFacts) => w.drunk + 0.3 * (w.bought - w.drunk) + 4 * w.opinion;

  const tally = (keyOf: (w: WineFacts) => { key: string; label: string }[]): Affinity[] => {
    const sums = new Map<string, Affinity & { raw: number }>();
    for (const w of wines.values()) {
      for (const { key, label } of keyOf(w)) {
        const a = sums.get(key) ?? { key, label, value: 0, raw: 0, bought: 0, drunk: 0 };
        a.raw += signal(w);
        a.bought += w.bought;
        a.drunk += w.drunk;
        sums.set(key, a);
      }
    }
    const kept = [...sums.values()].filter((a) => a.raw > 0 && !notReally.has(a.key));
    const max = Math.max(0, ...kept.map((a) => a.raw));
    return kept
      .map(({ raw, ...a }) => ({ ...a, value: max > 0 ? Math.sqrt(raw / max) : 0 }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  };

  const grapes = tally((w) => w.grapes.map((g) => ({ key: `grape:${g}`, label: g })));
  const places = tally((w) => {
    const key = placeKey(w.country, w.region);
    return key ? [{ key: `place:${key}`, label: placeLabel(w.country, w.region) }] : [];
  });
  const producers = tally((w) =>
    w.producer ? [{ key: `producer:${w.producer}`, label: w.producer }] : [],
  );

  // Favourites: producers they buy a fair amount of and drink fastest.
  const favourites = producers
    .filter((p) => p.bought >= 6 && p.drunk >= 6)
    .map((p) => ({ p, rate: (p.drunk / p.bought) * Math.log(1 + p.drunk) }))
    .sort((a, b) => b.rate - a.rate)
    .map((x) => x.p)
    .slice(0, 5);

  const all = [...wines.values()];
  const loved = all
    .filter((w) => w.opinion >= 3)
    .sort((a, b) => b.opinion - a.opinion)
    .map((w) => w.name)
    .slice(0, 6);
  const disliked = all.filter((w) => w.opinion < 0 && !notReally.has(`dislike:${w.wineId}`));
  const notForMe = new Set(disliked.map((w) => w.wineId));

  // Style: the colour and body of most bottles.
  const bottlesBought = all.reduce((s, w) => s + w.bought, 0);
  const bottlesDrunk = all.reduce((s, w) => s + w.drunk, 0);
  const share = (pick: (w: WineFacts) => string | null) => {
    const m = new Map<string, number>();
    for (const w of all) {
      const k = pick(w);
      if (k) m.set(k, (m.get(k) ?? 0) + w.bought);
    }
    const top = [...m].sort((a, b) => b[1] - a[1])[0];
    return top && bottlesBought > 0 ? { key: top[0], share: top[1] / bottlesBought } : null;
  };
  const topColour = share((w) => w.colour);
  const topBody = share((w) => w.body);
  const style = {
    colour: topColour && topColour.share >= 0.6 ? topColour.key : null,
    body: topBody && topBody.share >= 0.5 ? topBody.key : null,
    share: topColour?.share ?? 0,
  };

  // The lines they can say "not really" to.
  const lines: ProfileLine[] = [];
  const styleKey = `style:${style.colour ?? ''}-${style.body ?? ''}`;
  let styleText: string | null = null;
  if (style.colour && !notReally.has(styleKey)) {
    const body = style.body ? `${style.body}-bodied ` : '';
    styleText = `${body}${COLOUR_WORD[style.colour] ?? style.colour}`;
    lines.push({
      key: styleKey,
      text: `Mostly ${styleText} (${Math.round(style.share * 100)}% of your bottles)`,
    });
  }
  for (const g of grapes.slice(0, 4)) lines.push({ key: g.key, text: `You love ${g.label}` });
  for (const p of places.slice(0, 4))
    lines.push({ key: p.key, text: `You love wines from ${p.label}` });
  for (const f of favourites.slice(0, 4)) {
    lines.push({
      key: f.key,
      text: `You open ${f.label} fast (${f.drunk} of ${f.bought} bottles drunk)`,
    });
  }
  for (const w of disliked.slice(0, 3)) {
    lines.push({ key: `dislike:${w.wineId}`, text: `${w.name} isn't for you` });
  }

  // The headline.
  const parts: string[] = [];
  const topGrapes = grapes.slice(0, 2).map((g) => g.label);
  const topPlaces = places.slice(0, 3).map((p) => p.label);
  if (styleText || topGrapes.length) {
    let s = `You lean to ${styleText ?? 'wines'}`;
    if (topGrapes.length) s += `, above all ${list(topGrapes)}`;
    if (topPlaces.length) s += ` from ${list(topPlaces)}`;
    parts.push(`${s}.`);
  }
  if (favourites.length) {
    parts.push(
      `The bottles you open fastest are ${list(favourites.slice(0, 3).map((f) => f.label))}.`,
    );
  }
  const headline = parts.join(' ') || 'Not enough to go on yet. Take the quiz to get started.';

  // The quiz in words.
  const quizParts = (['fruit', 'tannin', 'acidity', 'oak', 'age'] as QuizKey[])
    .map((k) => answerLabel(k, quiz[k]))
    .filter((l): l is string => !!l && l !== 'No preference');
  const quizLine = quizParts.length ? `From your quiz: ${quizParts.join(', ')}.` : null;

  return {
    bottlesBought,
    bottlesDrunk,
    ownNotes,
    quizDone: Object.keys(quiz).length > 0,
    quiz,
    notReally,
    grapes,
    places,
    favourites,
    loved,
    notForMe,
    notForMeNames: disliked.map((w) => w.name).slice(0, 6),
    headline,
    lines,
    quizLine,
    style,
  };
}

// Using the profile -----------------------------------------------------------

const BODY_ORDER = ['light', 'medium', 'full'];

/** 0..1: how well the quiz answers fit a wine; null when the quiz says nothing about it. */
function quizFit(i: CellarItem, q: QuizAnswers): number | null {
  const parts: number[] = [];
  if (q.colour === 'red' || q.colour === 'white') {
    if (i.colour) parts.push(i.colour === q.colour ? 1 : 0.2);
  }
  if (q.body && BODY_ORDER.includes(q.body) && i.body && BODY_ORDER.includes(i.body)) {
    const gap = Math.abs(BODY_ORDER.indexOf(q.body) - BODY_ORDER.indexOf(i.body));
    parts.push(gap === 0 ? 1 : gap === 1 ? 0.5 : 0);
  }
  const w = world(i.country);
  if ((q.world === 'old' || q.world === 'new') && w) parts.push(w === q.world ? 1 : 0.3);
  if (q.redStyle && i.colour === 'red') {
    const family = RED_STYLE_GRAPES[q.redStyle] ?? [];
    const hit = i.grapes.some((g) => family.includes(g.toLowerCase()));
    parts.push(hit ? 1 : 0.3);
  }
  const t = traitsOf(i);
  if (t) {
    const want = (target: number, have: number) => 1 - Math.min(Math.abs(target - have), 2) / 2;
    const fruit = { ripe: 2, balanced: 1, savoury: 0 }[q.fruit ?? ''];
    if (fruit != null) parts.push(want(fruit, t.fruit));
    const tannin = { soft: 0.5, some: 1.2, firm: 2 }[q.tannin ?? ''];
    if (tannin != null && i.colour === 'red') parts.push(want(tannin, t.tannin));
    const acid = { bright: 1.8, round: 0.6 }[q.acidity ?? ''];
    if (acid != null) parts.push(want(acid, t.acid));
    const oak = { little: 0.3, some: 1, lots: 2 }[q.oak ?? ''];
    if (oak != null) parts.push(want(oak, t.oak));
  }
  if (parts.length === 0) return null;
  return parts.reduce((s, p) => s + p, 0) / parts.length;
}

export type PalateFit = {
  /** 0..1. */
  fit: number;
  /** They gave this wine a thumbs down or a low score. */
  notForMe: boolean;
  /** A short reason for Tonight, or null. */
  why: string | null;
};

/** How well one bottle fits the owner's palate. */
export function palateFit(i: CellarItem, p: PalateProfile): PalateFit {
  if (p.notForMe.has(i.wineId)) return { fit: 0, notForMe: true, why: null };
  const aff = (list: Affinity[], key: string) => list.find((a) => a.key === key)?.value ?? 0;
  const grape = Math.max(0, ...i.grapes.map((g) => aff(p.grapes, `grape:${g}`)));
  const pk = placeKey(i.country, i.region);
  const place = pk ? aff(p.places, `place:${pk}`) : 0;
  const favourite = i.producer
    ? p.favourites.find((f) => f.key === `producer:${i.producer}`)
    : undefined;
  const producer = favourite ? 1 : 0;
  const styleOk =
    (!p.style.colour || p.style.colour === i.colour ? 0.5 : 0) +
    (!p.style.body || p.style.body === i.body ? 0.5 : 0);
  const history = 0.4 * grape + 0.3 * place + 0.2 * producer + 0.1 * styleOk;
  const q = p.quizDone ? quizFit(i, p.quiz) : null;
  const fit = q == null ? history : 0.55 * history + 0.45 * q;

  let why: string | null = null;
  if (favourite) why = `You open ${favourite.label} often`;
  else if (fit >= 0.7) why = 'Right up your street';
  return { fit: Math.min(Math.max(fit, 0), 1), notForMe: false, why };
}

/**
 * How much the palate counts in Tonight's ranking, from the adventure answer.
 * An ask for a surprise turns it around, so less familiar bottles come up.
 */
export function palateWeight(p: PalateProfile, surprise: boolean): number {
  if (surprise) return -0.15;
  if (p.quiz.adventure === 'favourites') return 0.3;
  if (p.quiz.adventure === 'surprise') return 0.08;
  return 0.18;
}

/** A small nudge for how mature they like their bottles. */
export function ageNudge(p: PalateProfile, state: ReadyState): number {
  if (p.quiz.age === 'mature' && (state === 'peak' || state === 'soon')) return 0.06;
  if (p.quiz.age === 'young' && state === 'ready') return 0.06;
  return 0;
}

/** The profile in a few plain sentences, for the sommelier (Claude). */
export function palateText(p: PalateProfile): string {
  const out: string[] = [];
  if (p.style.colour) {
    out.push(
      `Mostly ${p.style.body ? `${p.style.body}-bodied ` : ''}${COLOUR_WORD[p.style.colour] ?? p.style.colour}.`,
    );
  }
  if (p.grapes.length)
    out.push(
      `Favourite grapes: ${p.grapes
        .slice(0, 5)
        .map((g) => g.label)
        .join('; ')}.`,
    );
  if (p.places.length)
    out.push(
      `Favourite regions: ${p.places
        .slice(0, 5)
        .map((g) => g.label)
        .join('; ')}.`,
    );
  if (p.favourites.length)
    out.push(`Opens these producers fastest: ${p.favourites.map((f) => f.label).join('; ')}.`);
  if (p.loved.length) out.push(`Loved: ${p.loved.slice(0, 4).join('; ')}.`);
  if (p.notForMeNames.length) out.push(`Not for them: ${p.notForMeNames.slice(0, 3).join('; ')}.`);
  const quiz = (Object.keys(p.quiz) as QuizKey[])
    .filter((k) => k !== 'adventure')
    .map((k) => answerLabel(k, p.quiz[k]))
    .filter((l): l is string => !!l && !/no preference|either|both/i.test(l));
  if (quiz.length) out.push(`Says they like: ${quiz.join('; ')}.`);
  const adv = answerLabel('adventure', p.quiz.adventure);
  if (adv) out.push(`Suggestions: ${adv.toLowerCase()}.`);
  return out.join(' ').slice(0, 900);
}
