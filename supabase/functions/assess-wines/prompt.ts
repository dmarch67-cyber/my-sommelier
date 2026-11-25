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
  /** CellarTracker's own window, kept even after a blended window replaces it. */
  ct_drink_from?: number | null;
  ct_drink_to?: number | null;
  scores: ScoreIn[];
  own_notes: OwnNoteIn[];
  /** Critic, merchant and winery notes quoted on public pages (gather-notes). */
  published?: PublishedNoteIn[];
};
export type PublishedNoteIn = {
  author: string;
  kind: string;
  score: string | null;
  noted_on: string | null;
  note: string;
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
2. Recent tasting notes from the last two years, given below as a digest gathered from CellarTracker community notes, WineBerserkers, Reddit, merchants and critics. Several recent notes agreeing that a wine is tiring, drying out or past its peak should pull the end of the window in, even if a critic's older window runs later. Several saying it is still tight or closed should push the start out. Only vintages that are drinkable now or soon were searched. Notes from the last 12 months count fully, notes 12 to 24 months old count half, and older notes are background only and do not count as recent.
3. Critic windows, scores and published critic notes (Vinous, Wine Advocate, Burghound, Jancis Robinson and others), and the CellarTracker window. Older critic windows are a starting point, not the answer.
4. Your own knowledge of the producer, appellation and vintage.

Do not invent notes: where the digest has little or nothing, say so in the summary, rely on the other evidence and set confidence to low.

For each vintage give drink_from and drink_to as calendar years (drink_to never before drink_from), how mature it is now, your confidence, a two or three sentence summary of what recent notes say, how many recent notes the digest has for it, and the year of the latest one. List every vintage. Put the pages the digest drew on in sources.`;
}

// ---------------------------------------------------------------------------
// Step 1: a small, cheap model searches and reads, and returns a short digest
// of dated tasting notes. Only vintages drinkable now or soon are searched.

export const READER_MODEL = 'claude-haiku-5-5';

/** Vintages worth searching: no window yet, or one that opens within two years. */
export function nearReady(w: WineIn, year: number): VintageIn[] {
  return w.vintages.filter((v) => {
    const from = v.ct_drink_from ?? v.drink_from;
    return from == null || from <= year + 2;
  });
}

export const SIGNALS = [...MATURITIES, 'unclear'] as const;

export const NOTES_TOOL = {
  name: 'record_notes',
  description: 'Record the dated tasting notes you found. Call it exactly once, after searching.',
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
          required: ['vintage_id', 'notes'],
          properties: {
            vintage_id: { type: 'string' },
            notes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['date', 'source', 'signal', 'gist'],
                properties: {
                  date: { type: 'string', description: 'YYYY-MM or YYYY of the note.' },
                  source: {
                    type: 'string',
                    description: 'e.g. CellarTracker, WineBerserkers, Vinous.',
                  },
                  signal: { type: 'string', enum: [...SIGNALS] },
                  gist: { type: 'string', description: 'At most 25 words, in your own words.' },
                },
              },
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

export function readerSystem(year: number): string {
  return `You gather recent tasting notes on wines for a cellar master. It is ${year}. Search the web for notes on the vintages listed, from the last two to three years. Start with CellarTracker, whose wine pages hold the most community notes: search for the producer, wine and vintage with the word cellartracker. Look hardest for the newest notes, from this year and last year; search results often show only older notes, so also try searching with the year in the query. Then try WineBerserkers, Reddit, merchants and critics. One search can cover several vintages. Do not search vintages that are not listed.

For each vintage, record up to six of the most recent notes you actually found, each with its date, source, a maturity signal (too_young, approaching, ready, peak, declining, past_it, or unclear) and a gist of at most 25 words in your own words. Never invent a note; an empty list is fine. Then call record_notes once.`;
}

export function readerText(w: WineIn, near: VintageIn[]): string {
  const place = [w.appellation, w.region, w.country].filter(Boolean).join(', ');
  return [
    `Wine: ${w.name}${w.producer ? ` (producer ${w.producer})` : ''}${place ? `, ${place}` : ''}`,
    'Vintages to search:',
    ...near.map((v) => `- vintage_id ${v.id}: ${v.year ?? 'NV'}`),
  ].join('\n');
}

export type DigestNote = { date: string; source: string; signal: string; gist: string };
export type Digest = {
  notes: Map<string, DigestNote[]>;
  sources: { url: string; title: string }[];
};

/** Checks the reader's answer: only the vintages searched, short notes. */
export function cleanDigest(raw: unknown, near: VintageIn[]): Digest {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ids = new Set(near.map((v) => v.id));
  const notes = new Map<string, DigestNote[]>();
  for (const item of Array.isArray(obj.vintages) ? obj.vintages : []) {
    const r = item as Record<string, unknown>;
    if (!r || typeof r.vintage_id !== 'string' || !ids.has(r.vintage_id)) continue;
    const list: DigestNote[] = [];
    for (const n of Array.isArray(r.notes) ? r.notes : []) {
      const x = n as Record<string, unknown>;
      if (!x || typeof x.gist !== 'string' || !x.gist.trim()) continue;
      list.push({
        date: String(x.date ?? '').slice(0, 10),
        source: String(x.source ?? '').slice(0, 40),
        signal: SIGNALS.includes(x.signal as (typeof SIGNALS)[number])
          ? String(x.signal)
          : 'unclear',
        gist: x.gist.trim().slice(0, 200),
      });
    }
    notes.set(r.vintage_id, [...(notes.get(r.vintage_id) ?? []), ...list].slice(0, 8));
  }
  const sources: { url: string; title: string }[] = [];
  for (const s of Array.isArray(obj.sources) ? obj.sources : []) {
    const r = s as Record<string, unknown>;
    if (r && typeof r.url === 'string' && /^https?:\/\//.test(r.url)) {
      sources.push({ url: r.url.slice(0, 500), title: String(r.title ?? '').slice(0, 200) });
    }
  }
  return { notes, sources: sources.slice(0, 20) };
}

/** The digest as the judge reads it, under the wine's own facts. */
export function digestText(w: WineIn, near: VintageIn[], d: Digest | null): string {
  const searched = new Set(near.map((v) => v.id));
  const lines = ['', 'Recent tasting notes digest:'];
  for (const v of w.vintages) {
    const label = `${v.year ?? 'NV'} (vintage_id ${v.id})`;
    if (!searched.has(v.id)) {
      lines.push(`- ${label}: not searched (not near its window yet)`);
      continue;
    }
    const notes = d?.notes.get(v.id) ?? [];
    if (notes.length === 0) {
      lines.push(`- ${label}: no recent notes found`);
      continue;
    }
    lines.push(`- ${label}:`);
    for (const n of notes) lines.push(`  ${n.date} ${n.source} [${n.signal}] ${n.gist}`);
  }
  if (d?.sources.length) {
    lines.push('', 'Pages the digest drew on:');
    for (const s of d.sources) lines.push(`- ${s.title} ${s.url}`);
  }
  return lines.join('\n');
}

/** The judge's answer schema (same fields as before, as a structured output). */
export const ASSESSMENT_SCHEMA = RECORD_TOOL.input_schema;

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
    // CellarTracker's window, and the owner's own if they set one. Earlier
    // guesses by Claude (estimate, blended) are left out so a review is not
    // anchored on itself.
    const ctFrom =
      v.ct_drink_from ?? (v.drink_window_source === 'cellartracker' ? v.drink_from : null);
    const ctTo = v.ct_drink_to ?? (v.drink_window_source === 'cellartracker' ? v.drink_to : null);
    if (ctFrom && ctTo) lines.push(`  CellarTracker window: ${ctFrom}-${ctTo}`);
    if (v.drink_window_source === 'owner' && v.drink_from && v.drink_to) {
      lines.push(`  owner's window: ${v.drink_from}-${v.drink_to}`);
    }
    for (const s of v.scores) lines.push(`  score: ${scoreLine(s)}`);
    for (const n of v.own_notes) {
      const bits = [n.tasted_on, n.maturity, n.rating != null ? `${n.rating} pts` : null, n.notes];
      lines.push(`  owner's note: ${bits.filter(Boolean).join(' · ')}`);
    }
    for (const n of (v.published ?? []).filter((p) => p.kind !== 'winery').slice(0, 6)) {
      const head = [n.author, n.score, n.noted_on ?? 'undated'].filter(Boolean).join(', ');
      const body = n.note.length > 400 ? n.note.slice(0, 400) + '…' : n.note;
      lines.push(`  published note (${head}): ${body}`);
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
