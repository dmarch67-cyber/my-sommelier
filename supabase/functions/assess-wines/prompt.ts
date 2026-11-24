// What the blended-window review asks Claude, and the shape of its answer.
// Plain TypeScript with no Deno or Node APIs, so the app's tests can import it too.

export const MODEL = 'claude-opus-5-5';

export const MATURITIES = [
  'too_young',
  'approaching',
  'ready',
  'peak',
  'declining',
  'past_it',
] as const;
export type Maturity = (typeof MATURITIES)[number];

export type ScoreIn = {
  source: string;
  source_detail: string | null;
  raw_value: string;
  drink_from: number | null;
  drink_to: number | null;
  reviewed_on: string | null;
};
export type OwnNoteIn = {
  tasted_on: string;
  maturity: string | null;
  rating: number | null;
  notes: string | null;
};
export type VintageIn = {
  id: string;
  year: number | null;
  bottles: number;
  drink_from: number | null;
  drink_to: number | null;
  drink_window_source: string | null;
  scores: ScoreIn[];
  own_notes: OwnNoteIn[];
};
export type WineIn = {
  id: string;
  name: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  colour: string | null;
  grapes: string[];
  vintages: VintageIn[];
};

export type VintageOut = {
  vintage_id: string;
  drink_from: number | null;
  drink_to: number | null;
  maturity: Maturity | null;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  recent_notes: number;
  latest_note_year: number | null;
};

export const RECORD_TOOL = {
  name: 'record_assessment',
  description:
    'Record the blended drinking window for every vintage listed. Call it exactly once, after your research.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['vintages', 'sources'],
    properties: {
      vintages: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'vintage_id',
            'drink_from',
            'drink_to',
            'maturity',
            'confidence',
            'summary',
            'recent_notes',
            'latest_note_year',
          ],
          properties: {
            vintage_id: { type: 'string' },
            drink_from: { type: 'integer' },
            drink_to: { type: 'integer' },
            maturity: { type: 'string', enum: [...MATURITIES] },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            summary: {
              type: 'string',
              description:
                'Two or three sentences on what recent notes say about how it is drinking now and where it is heading.',
            },
            recent_notes: {
              type: 'integer',
              description:
                'How many tasting notes from the last two years you found for this vintage.',
            },
            latest_note_year: {
              type: ['integer', 'null'],
              description: 'Year of the most recent note you found, or null.',
            },
          },
        },
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'title'],
          properties: { url: { type: 'string' }, title: { type: 'string' } },
        },
      },
    },
  },
} as const;

export function systemPrompt(year: number): string {
  return `You are the cellar master for a private wine collector. For one wine at a time, you set a single drinking window for each vintage the collector owns, as an experienced sommelier would after reading everything current about it. It is ${year}.

Weigh the evidence in this order:
1. The owner's own tasting notes, when given.
2. Recent tasting notes from the last two years (CellarTracker community notes, WineBerserkers threads, Reddit, merchant and critic write-ups). Several recent notes agreeing that a wine is tiring, drying out or past its peak should pull the end of the window in, even if a critic's older window runs later. Several saying it is still tight or closed should push the start out.
3. Critic windows and scores (Vinous, Wine Advocate, Burghound, Jancis Robinson and others), and the CellarTracker window. Older critic windows are a starting point, not the answer.
4. Your own knowledge of the producer, appellation and vintage.

Use web search to find recent notes. Search for the producer, cuvée and vintage; a few targeted searches per wine is plenty, and you can cover several vintages in one search. Do not invent notes: if you find little, say so in the summary, rely on the other evidence and set confidence to low.

For each vintage give drink_from and drink_to as calendar years (drink_to never before drink_from), how mature it is now, your confidence, and a short summary of what recent notes say. Then call record_assessment once with every vintage listed. Keep the sources to the pages that actually informed you.`;
}

function scoreLine(s: ScoreIn): string {
  const who = s.source_detail?.replace(/^CellarTracker export:\s*/, '') || s.source;
  const window = s.drink_from && s.drink_to ? `, window ${s.drink_from}-${s.drink_to}` : '';
  const when = s.reviewed_on ? `, reviewed ${s.reviewed_on}` : '';
  return `${who} ${s.raw_value}${window}${when}`;
}

export function userText(w: WineIn): string {
  const place = [w.appellation, w.region, w.country].filter(Boolean).join(', ');
  const lines = [
    `Wine: ${w.name}`,
    w.producer ? `Producer: ${w.producer}` : null,
    place ? `From: ${place}` : null,
    w.colour ? `Colour: ${w.colour}` : null,
    w.grapes.length ? `Grapes: ${w.grapes.join(', ')}` : null,
    '',
    'Vintages owned:',
  ].filter((l): l is string => l !== null);
  for (const v of w.vintages) {
    lines.push(`- vintage_id ${v.id}: ${v.year ?? 'NV'} (${v.bottles} bottles)`);
    if (v.drink_from && v.drink_to) {
      const from = v.drink_window_source === 'cellartracker' ? 'CellarTracker' : 'current';
      lines.push(`  ${from} window: ${v.drink_from}-${v.drink_to}`);
    }
    for (const s of v.scores) lines.push(`  score: ${scoreLine(s)}`);
    for (const n of v.own_notes) {
      const bits = [n.tasted_on, n.maturity, n.rating != null ? `${n.rating} pts` : null, n.notes];
      lines.push(`  owner's note: ${bits.filter(Boolean).join(' · ')}`);
    }
  }
  return lines.join('\n');
}

/** Checks Claude's answer: only the vintages asked about, sensible years, short summaries. */
export function cleanAssessment(
  raw: unknown,
  w: WineIn,
  year: number,
): { vintages: VintageOut[]; sources: { url: string; title: string }[] } {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const asked = new Map(w.vintages.map((v) => [v.id, v]));
  const seen = new Set<string>();
  const vintages: VintageOut[] = [];
  for (const item of Array.isArray(obj.vintages) ? obj.vintages : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const v = typeof r.vintage_id === 'string' ? asked.get(r.vintage_id) : undefined;
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id);
    let from = Number.isInteger(r.drink_from) ? (r.drink_from as number) : null;
    let to = Number.isInteger(r.drink_to) ? (r.drink_to as number) : null;
    const earliest = v.year ?? 1900;
    const ok =
      from != null &&
      to != null &&
      to >= from &&
      from >= earliest &&
      to <= earliest + 100 &&
      to >= 1900;
    if (!ok) {
      from = null;
      to = null;
    }
    const notes = Number.isInteger(r.recent_notes) ? Math.max(0, r.recent_notes as number) : 0;
    const latest =
      Number.isInteger(r.latest_note_year) &&
      (r.latest_note_year as number) >= 1900 &&
      (r.latest_note_year as number) <= year
        ? (r.latest_note_year as number)
        : null;
    vintages.push({
      vintage_id: v.id,
      drink_from: from,
      drink_to: to,
      maturity: MATURITIES.includes(r.maturity as Maturity) ? (r.maturity as Maturity) : null,
      confidence: r.confidence === 'high' || r.confidence === 'medium' ? r.confidence : 'low',
      summary: typeof r.summary === 'string' ? r.summary.trim().slice(0, 800) : '',
      recent_notes: notes,
      latest_note_year: latest,
    });
  }
  const sources: { url: string; title: string }[] = [];
  for (const s of Array.isArray(obj.sources) ? obj.sources : []) {
    const r = s as Record<string, unknown>;
    if (r && typeof r.url === 'string' && /^https?:\/\//.test(r.url)) {
      sources.push({ url: r.url.slice(0, 500), title: String(r.title ?? '').slice(0, 200) });
    }
  }
  return { vintages, sources: sources.slice(0, 20) };
}
