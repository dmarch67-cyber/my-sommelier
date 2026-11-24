// What the food-match fill-in asks Claude, and the shape of the answer.
// Plain TypeScript with no Deno or Node APIs, so the app's tests can import it too.

export const MODEL = 'claude-opus-5-5';

/** Wines per call. Small enough to finish well inside the function time limit. */
export const BATCH_SIZE = 12;
export const MIN_DISHES = 4;
export const MAX_DISHES = 6;

/** One wine, as wines_needing_food_matches() returns it. */
export type WineToMatch = {
  id: string;
  account_id: string;
  name: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  sub_region: string | null;
  appellation: string | null;
  colour: string | null;
  body: string | null;
  grapes: string[] | null;
};

export type Dish = { dish: string; why: string };

/** One wine's dishes, in the shape the wine_food_matches table takes. */
export type FoodMatch = {
  wine_id: string;
  account_id: string;
  dishes: Dish[];
  avoid: string | null;
  older: string | null;
};

export const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['wines'],
  properties: {
    wines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['wine_id', 'dishes', 'avoid', 'older'],
        properties: {
          wine_id: { type: 'string' },
          dishes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['dish', 'why'],
              properties: { dish: { type: 'string' }, why: { type: 'string' } },
            },
          },
          avoid: { type: ['string', 'null'] },
          older: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

// Same voice and the same pairing sense as the Tonight sommelier
// (suggest-wines), so the Wine page and Tonight never disagree.
export const SYSTEM = `You are the private sommelier for one collector's wine cellar. For each wine you are given, suggest the dishes that suit it best, for the Wine page of their cellar app.

For each wine give:
- dishes: ${MIN_DISHES} to ${MAX_DISHES} dishes, best first. Mix the classic regional match with everyday dinners a home cook would actually make (a roast, a steak, a pasta, a fish, a cheese). Each has:
  - dish: a short dish name a person would type when asking what to drink, e.g. "Roast leg of lamb with rosemary", "Grilled salmon", "Mushroom risotto", "Aged Comté". At most 6 words. No brand names.
  - why: one short sentence (under 15 words) in plain, warm language a non-expert enjoys, on why they work together, e.g. "The firm tannins love the fat." No scores, no years, no source names.
- avoid: one short sentence naming the kind of food to avoid and why, e.g. "Skip spicy Thai; the heat clashes with the oak." null if nothing stands out.
- older: one short sentence on what suits this wine once it is mature, if age changes the match (older reds and whites usually prefer simpler, gentler dishes), e.g. "Once mature, keep it simple: roast chicken or veal." null if age makes no real difference (most rosé, most non-vintage sparkling, simple everyday wines).

Base the matches on the grapes, place, colour and body given, and on what you know of the producer and wine. If the facts are thin, use the region's typical style and stay sensible.

Answer for every wine id you are given, using the ids exactly as given.`;

export function userText(wines: WineToMatch[]): string {
  const lines = wines.map((w) => {
    const place = [w.appellation, w.sub_region, w.region, w.country].filter(Boolean).join(', ');
    const style = [w.colour, w.body ? `${w.body} body` : null].filter(Boolean).join(', ');
    return [
      `wine ${w.id}`,
      w.name,
      w.producer ? `producer: ${w.producer}` : null,
      place || null,
      style || null,
      w.grapes?.length ? `grapes: ${w.grapes.join('/')}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
  });
  return `Wines:\n${lines.join('\n')}`;
}

function sentence(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Checks Claude's answer against the wines that were asked about. Wines with
 * fewer than two usable dishes are left out, so they are asked about again.
 */
export function cleanMatches(raw: unknown, asked: WineToMatch[]): FoodMatch[] {
  const items =
    raw && typeof raw === 'object' && Array.isArray((raw as { wines?: unknown }).wines)
      ? ((raw as { wines: unknown[] }).wines as Record<string, unknown>[])
      : [];
  const byId = new Map(items.filter((i) => i && typeof i === 'object').map((i) => [i.wine_id, i]));

  const out: FoodMatch[] = [];
  for (const wine of asked) {
    const r = byId.get(wine.id);
    if (!r) continue;
    const seen = new Set<string>();
    const dishes: Dish[] = [];
    for (const d of Array.isArray(r.dishes) ? (r.dishes as Record<string, unknown>[]) : []) {
      const dish = sentence(d?.dish, 60);
      const why = sentence(d?.why, 160);
      if (!dish || !why || seen.has(dish.toLowerCase())) continue;
      seen.add(dish.toLowerCase());
      dishes.push({ dish, why });
      if (dishes.length === MAX_DISHES) break;
    }
    if (dishes.length < 2) continue;
    out.push({
      wine_id: wine.id,
      account_id: wine.account_id,
      dishes,
      avoid: sentence(r.avoid, 200),
      older: sentence(r.older, 200),
    });
  }
  return out;
}
