// What the wine fill-in asks Claude, and the shape of the answer.
// Plain TypeScript with no Deno or Node APIs, so the app's tests can import it too.

export const MODEL = 'claude-opus-5-5';

/** How many wines go to Claude in one call. Small enough to finish well inside the function time limit. */
export const BATCH_SIZE = 15;

export type WineToFill = {
  id: string;
  name: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  vintages: { id: string; year: number | null }[];
};

export type Colour = 'red' | 'white' | 'rose' | 'sparkling' | 'sweet' | 'fortified' | 'orange';
export type Body = 'light' | 'medium' | 'full';

/** One wine's fill-in, in the shape apply_wine_enrichment() takes. */
export type WineFill = {
  wine_id: string;
  colour: Colour | null;
  body: Body | null;
  producer: string | null;
  grapes: string[];
  vintages: { vintage_id: string; drink_from: number; drink_to: number }[];
};

const COLOURS = ['red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'orange'] as const;
const BODIES = ['light', 'medium', 'full'] as const;

export const FILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['wines'],
  properties: {
    wines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['wine_id', 'identified', 'colour', 'body', 'producer', 'grapes', 'vintages'],
        properties: {
          wine_id: { type: 'string' },
          identified: { type: 'boolean' },
          colour: { type: 'string', enum: [...COLOURS, 'unknown'] },
          body: { type: 'string', enum: [...BODIES, 'unknown'] },
          producer: { type: ['string', 'null'] },
          grapes: { type: 'array', items: { type: 'string' } },
          vintages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['vintage_id', 'drink_from', 'drink_to'],
              properties: {
                vintage_id: { type: 'string' },
                drink_from: { type: ['integer', 'null'] },
                drink_to: { type: ['integer', 'null'] },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const SYSTEM = `You are an experienced sommelier filling in basic facts for wines in a private collector's cellar app. The names come from the owner's spreadsheet ("producer then cuvée"; Bordeaux châteaux often without the word "Château").

For each wine give:
- identified: true if you recognise the wine (producer and cuvée). false if you are guessing from the name alone.
- colour: red, white, rose, sparkling, sweet (dessert wines such as Sauternes, Tokaji, late-harvest), fortified (Port, Sherry, Madeira), or orange. Champagne and other traditional-method wines are sparkling, including rosé Champagne. Use "unknown" only if the name gives no clue.
- body: light, medium or full, for how this wine usually tastes in the glass. Examples: Beaujolais, most Oregon Pinot Noir from cool years and Chablis are light to medium; Napa Cabernet, Barolo, Châteauneuf-du-Pape, Hermitage and most top Bordeaux are full; oaked Napa Chardonnay is full; Champagne is usually light or medium. "unknown" only if you cannot tell.
- producer: the producer's usual short name ("Ridge", "Domaine Serene", "Lafon-Rochet"). null if unclear.
- grapes: the main grape varieties, most important first, at most four. Empty if unknown.
- vintages: for each vintage id given, the drinking window as calendar years (drink_from, drink_to): from when the wine starts to show well until when it should be drunk before it fades, as a well-informed critic would put it for that producer and vintage. Use what you know of the vintage's quality and the wine's track record. A non-vintage wine (year missing) gets a window counted from the current year. If you cannot identify the wine, still give a cautious window based on its type and region, but never invent precision you do not have. Use null for both only when there is truly nothing to go on.

Answer for every wine id you are given, using the ids exactly as given.`;

export function userText(wines: WineToFill[], currentYear: number): string {
  const lines = wines.map((w) => {
    const place = [w.appellation, w.region, w.country].filter(Boolean).join(', ');
    const vintages = w.vintages.map((v) => `${v.id}=${v.year ?? 'NV'}`).join('; ');
    return `wine ${w.id} | ${w.name}${w.producer ? ` | producer: ${w.producer}` : ''}${place ? ` | ${place}` : ''}\n  vintages: ${vintages || '(none)'}`;
  });
  return `Current year: ${currentYear}\n\nWines:\n${lines.join('\n')}`;
}

/**
 * Checks Claude's answer against the wines that were asked about and turns it
 * into fill-ins. Anything unknown or out of range is dropped, never guessed.
 */
export function cleanFill(raw: unknown, asked: WineToFill[], currentYear: number): WineFill[] {
  const items =
    raw && typeof raw === 'object' && Array.isArray((raw as { wines?: unknown }).wines)
      ? ((raw as { wines: unknown[] }).wines as Record<string, unknown>[])
      : [];
  const byId = new Map(items.filter((i) => i && typeof i === 'object').map((i) => [i.wine_id, i]));

  return asked.map((wine) => {
    const r = byId.get(wine.id) ?? {};
    const colour = COLOURS.includes(r.colour as Colour) ? (r.colour as Colour) : null;
    const body = BODIES.includes(r.body as Body) ? (r.body as Body) : null;
    const producer =
      typeof r.producer === 'string' && r.producer.trim() ? r.producer.trim().slice(0, 120) : null;
    const grapes = Array.isArray(r.grapes)
      ? [
          ...new Set(
            r.grapes
              .filter((g): g is string => typeof g === 'string')
              .map((g) => g.trim())
              .filter((g) => g.length > 0 && g.length < 60),
          ),
        ].slice(0, 4)
      : [];

    const askedVintages = new Map(wine.vintages.map((v) => [v.id, v.year]));
    const vintages: WineFill['vintages'] = [];
    for (const v of Array.isArray(r.vintages) ? (r.vintages as Record<string, unknown>[]) : []) {
      if (!v || typeof v.vintage_id !== 'string' || !askedVintages.has(v.vintage_id)) continue;
      const from = v.drink_from;
      const to = v.drink_to;
      if (typeof from !== 'number' || typeof to !== 'number') continue;
      if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) continue;
      const year = askedVintages.get(v.vintage_id) ?? null;
      // A window must start no earlier than the harvest and end within a
      // century of it (or of today for non-vintage wines).
      const base = year ?? currentYear;
      if (from < base - (year == null ? 5 : 0) || to > base + 100) continue;
      vintages.push({ vintage_id: v.vintage_id, drink_from: from, drink_to: to });
    }

    return { wine_id: wine.id, colour, body, producer, grapes, vintages };
  });
}
