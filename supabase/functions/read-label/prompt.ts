// What the label reader asks Claude, and the shape of the answer.
// Plain TypeScript with no Deno or Node APIs, so the app's tests can import it too.

export const MODEL = 'claude-opus-5-5';

/** A wine already in the cellar, offered to Claude so it can say "this is one you have". */
export type KnownWine = { id: string; name: string; place: string };

export type LabelReading = {
  is_wine_label: boolean;
  producer: string | null;
  wine_name: string | null;
  vintage: number | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  bottle_size_ml: number | null;
  match_wine_id: string | null;
  confidence: 'high' | 'medium' | 'low';
  note: string | null;
};

const text = { type: ['string', 'null'] };

export const READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_wine_label',
    'producer',
    'wine_name',
    'vintage',
    'country',
    'region',
    'appellation',
    'bottle_size_ml',
    'match_wine_id',
    'confidence',
    'note',
  ],
  properties: {
    is_wine_label: { type: 'boolean' },
    producer: text,
    wine_name: text,
    vintage: { type: ['integer', 'null'] },
    country: text,
    region: text,
    appellation: text,
    bottle_size_ml: { type: ['integer', 'null'] },
    match_wine_id: text,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: text,
  },
} as const;

export const SYSTEM = `You read photos of wine labels for a private cellar app and say exactly which wine it is.

How the cellar names wines (follow this style for wine_name):
- Producer then cuvée, the way a collector writes it in a spreadsheet: "Ridge Monte Bello", "Joseph Phelps Insignia", "Domaine Serene Evenstad Reserve Pinot Noir", "Mario Marengo Barolo Brunate".
- Bordeaux châteaux drop the word "Château": "Lafon Rochet", "Branaire Ducru", "D'Issan". Second wines keep their own name ("Carruades de Lafite").
- Keep accents. Use title case. No vintage, bottle size or alcohol in the name.

Fields:
- vintage: the year of the harvest printed on the label. null for non-vintage or if you cannot see it. Never guess a year.
- country: English name ("France", "USA", "Italy"). region: the broad region ("Bordeaux", "Burgundy", "California", "Oregon", "Piedmont", "Tuscany"). appellation: the specific place if shown ("Pauillac", "Napa Valley", "Dundee Hills"). You may fill country and region from your knowledge of the wine when the label shows only the appellation.
- bottle_size_ml: only if a size is printed or obvious (1500 for 1.5 L / magnum, 375 for 37.5 cl). Otherwise null.
- match_wine_id: if this is clearly the same wine (same producer and same cuvée) as one in the cellar list, give that id. A different cuvée from the same producer is not a match. Otherwise null.
- confidence: high when the label is clear and you are sure; medium when part is unclear; low when you are mostly guessing.
- note: one short plain sentence for the owner only when something needs checking (for example "The year is hidden by glare."). Otherwise null.
- If the photo is not a wine label, set is_wine_label to false and the other fields to null, with a short note saying what you see.`;

export function userText(known: KnownWine[]): string {
  const list = known.length
    ? known.map((w) => `${w.id} | ${w.name}${w.place ? ` | ${w.place}` : ''}`).join('\n')
    : '(empty)';
  return `Wines already in the cellar (id | name | place):\n${list}\n\nWhich wine is on this label?`;
}

/** Checks a reading that came back from the model; returns null if it is not usable. */
export function cleanReading(raw: unknown, known: KnownWine[]): LabelReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const year = int(r.vintage);
  const thisYear = new Date().getFullYear();
  const size = int(r.bottle_size_ml);
  const matchId = str(r.match_wine_id);
  const confidence =
    r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low'
      ? r.confidence
      : 'low';
  return {
    is_wine_label: r.is_wine_label === true,
    producer: str(r.producer),
    wine_name: str(r.wine_name),
    vintage: year !== null && year >= 1800 && year <= thisYear + 1 ? year : null,
    country: str(r.country),
    region: str(r.region),
    appellation: str(r.appellation),
    bottle_size_ml: size !== null && size >= 100 && size <= 30000 ? size : null,
    match_wine_id: matchId && known.some((w) => w.id === matchId) ? matchId : null,
    confidence,
    note: str(r.note),
  };
}
