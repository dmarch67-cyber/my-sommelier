// "Recheck window" on the Wine page: the owner asks for one vintage's
// drinking window to be looked at again, because it looks wrong to them.
// Same two steps as the full review (a small model gathers, the top model
// judges), but for a single vintage and more thoroughly:
//   * the reader may open pages (web fetch), not only read search snippets,
//     and also collects critic reviews of any age with their scores and
//     drinking windows, for this exact bottling;
//   * the judge says why it chose the window, which the app shows.
// Plain TypeScript with no Deno or Node APIs, so the app's tests can import it.

import { ASSESSMENT_SCHEMA, SIGNALS, type VintageIn, type WineIn } from './prompt.ts';

/** Sites never read automatically (their terms, or CellarTracker's robot check). */
export const NO_FETCH = ['cellartracker.com', 'vinous.com', 'wineberserkers.com', 'vivino.com'];

/** Rechecks one account may start in a day, so a stuck button can't run up a bill. */
export const DAILY_LIMIT = 30;

// Prices in US dollars (per million tokens, per search).
const PRICE = {
  reader_in: 0.1,
  reader_out: 0.5,
  judge_in: 4,
  judge_out: 20,
  search: 0.01,
};

export type RecheckUsage = {
  reader_input: number;
  reader_output: number;
  searches: number;
  fetches: number;
  judge_input: number;
  judge_output: number;
};

export function costUsd(u: RecheckUsage): number {
  const c =
    (u.reader_input * PRICE.reader_in + u.reader_output * PRICE.reader_out) / 1e6 +
    (u.judge_input * PRICE.judge_in + u.judge_output * PRICE.judge_out) / 1e6 +
    u.searches * PRICE.search;
  return Math.round(c * 10000) / 10000;
}

export const RECHECK_NOTES_TOOL = {
  name: 'record_findings',
  description:
    'Record the critic reviews and tasting notes you found for this exact wine and vintage. Call it exactly once, after researching.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['critics', 'notes', 'sources'],
    properties: {
      critics: {
        type: 'array',
        description:
          'Critic or publication reviews of any date, for this exact bottling and vintage.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['critic', 'score', 'drink_from', 'drink_to', 'date', 'gist'],
          properties: {
            critic: { type: 'string', description: 'e.g. Wine Enthusiast (Matt Kettmann).' },
            score: { type: ['string', 'null'] },
            drink_from: { type: ['integer', 'null'], description: 'Only if the critic gave one.' },
            drink_to: { type: ['integer', 'null'], description: 'Only if the critic gave one.' },
            date: { type: 'string', description: 'YYYY-MM or YYYY of the review.' },
            gist: {
              type: 'string',
              description:
                'At most 30 words in your own words, including anything said about ageing.',
            },
          },
        },
      },
      notes: {
        type: 'array',
        description: 'Tasting notes from drinkers, merchants or blogs, newest first.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['date', 'source', 'signal', 'gist'],
          properties: {
            date: { type: 'string', description: 'YYYY-MM or YYYY of the note.' },
            source: { type: 'string' },
            signal: { type: 'string', enum: [...SIGNALS] },
            gist: { type: 'string', description: 'At most 25 words, in your own words.' },
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

export function recheckReaderSystem(year: number): string {
  return `You research one wine for a cellar master who thinks its drinking window may be wrong. It is ${year}.

Find, for this exact wine and vintage:
1. Critic and publication reviews of any date (Wine Enthusiast, Wine Spectator, Wine Advocate, Jeb Dunnuck, James Suckling, Decanter, Vinous and others), with the score and any drinking window or advice on ageing.
2. Tasting notes from the last three years from drinkers, merchants and blogs, newest first, and what they say about how it is drinking.

Many producers make several bottlings with similar names (for example an entry-level, an Estate, a Reserve and a top cuvée). Only record reviews and notes for the exact bottling named; skip the others. Search results often show only a short snippet: open the most promising pages with web_fetch to read the full review. CellarTracker, Vinous and WineBerserkers pages cannot be opened, but what their search snippets show may be used.

Never invent a review or note; empty lists are fine. Then call record_findings once.`;
}

export function recheckReaderText(w: WineIn, v: VintageIn): string {
  const place = [w.appellation, w.region, w.country].filter(Boolean).join(', ');
  return [
    `Wine: ${w.name}${w.producer ? ` (producer ${w.producer})` : ''}`,
    place ? `From: ${place}` : null,
    w.grapes.length ? `Grapes: ${w.grapes.join(', ')}` : null,
    `Vintage: ${v.year ?? 'NV'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export type Findings = {
  critics: {
    critic: string;
    score: string | null;
    drink_from: number | null;
    drink_to: number | null;
    date: string;
    gist: string;
  }[];
  notes: { date: string; source: string; signal: string; gist: string }[];
  sources: { url: string; title: string }[];
};

/** Checks the reader's answer: short fields, sensible years, real links. */
export function cleanFindings(raw: unknown, vintageYear: number | null): Findings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (x: unknown, n: number) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const yearOk = (x: unknown) =>
    Number.isInteger(x) && (x as number) >= (vintageYear ?? 1900) && (x as number) <= 2300
      ? (x as number)
      : null;
  const critics: Findings['critics'] = [];
  for (const c of Array.isArray(obj.critics) ? obj.critics : []) {
    const r = (c ?? {}) as Record<string, unknown>;
    const gist = str(r.gist, 240);
    const critic = str(r.critic, 80);
    if (!gist || !critic) continue;
    let from = yearOk(r.drink_from);
    let to = yearOk(r.drink_to);
    if (from != null && to != null && to < from) {
      from = null;
      to = null;
    }
    critics.push({
      critic,
      score: str(r.score, 20) || null,
      drink_from: from,
      drink_to: to,
      date: str(r.date, 10),
      gist,
    });
  }
  const notes: Findings['notes'] = [];
  for (const n of Array.isArray(obj.notes) ? obj.notes : []) {
    const r = (n ?? {}) as Record<string, unknown>;
    const gist = str(r.gist, 200);
    if (!gist) continue;
    notes.push({
      date: str(r.date, 10),
      source: str(r.source, 40),
      signal: SIGNALS.includes(r.signal as (typeof SIGNALS)[number]) ? String(r.signal) : 'unclear',
      gist,
    });
  }
  const sources: Findings['sources'] = [];
  for (const s of Array.isArray(obj.sources) ? obj.sources : []) {
    const r = (s ?? {}) as Record<string, unknown>;
    if (typeof r.url === 'string' && /^https?:\/\//.test(r.url)) {
      sources.push({ url: r.url.slice(0, 500), title: str(r.title, 200) });
    }
  }
  return {
    critics: critics.slice(0, 10),
    notes: notes.slice(0, 10),
    sources: sources.slice(0, 20),
  };
}

/** What the reader found, as the judge reads it. */
export function findingsText(f: Findings | null): string {
  const lines = ['', 'What a fresh search found for this vintage:'];
  if (!f || (f.critics.length === 0 && f.notes.length === 0)) {
    lines.push('- nothing new found');
    return lines.join('\n');
  }
  for (const c of f.critics) {
    const window = c.drink_from && c.drink_to ? `, window ${c.drink_from}-${c.drink_to}` : '';
    lines.push(
      `- critic: ${c.critic}${c.score ? ` ${c.score}` : ''}${window} (${c.date || 'undated'}): ${c.gist}`,
    );
  }
  for (const n of f.notes) lines.push(`- note: ${n.date} ${n.source} [${n.signal}] ${n.gist}`);
  if (f.sources.length) {
    lines.push('', 'Pages:');
    for (const s of f.sources) lines.push(`- ${s.title} ${s.url}`);
  }
  return lines.join('\n');
}

export function recheckSystemExtra(): string {
  return `

The owner asked for this vintage to be rechecked because the window looked wrong to them. Read every piece of evidence afresh. A CellarTracker window is an average of drinkers' guesses and is often too short for structured wines; do not let it decide the window on its own. Weigh critic reviews and what they say about structure and ageing, the vintage's reputation in that appellation, and recent notes. In "why", say in two or three plain sentences which evidence set the start and the end of the window, naming the critics or notes you relied on. No source names like "the digest".`;
}

/** The judge's answer for a recheck: the usual fields plus "why". */
export const RECHECK_SCHEMA = (() => {
  const base = ASSESSMENT_SCHEMA as unknown as {
    properties: {
      vintages: { items: { required: string[]; properties: Record<string, unknown> } };
    };
  };
  const items = base.properties.vintages.items;
  return {
    ...ASSESSMENT_SCHEMA,
    properties: {
      ...ASSESSMENT_SCHEMA.properties,
      vintages: {
        ...ASSESSMENT_SCHEMA.properties.vintages,
        items: {
          ...items,
          required: [...items.required, 'why'],
          properties: {
            ...items.properties,
            why: {
              type: 'string',
              description:
                'Two or three sentences: which evidence set the start and end of the window.',
            },
          },
        },
      },
    },
  };
})();

/** The judge's "why" for the vintage, cleaned. */
export function cleanWhy(raw: unknown, vintageId: string): string {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const item of Array.isArray(obj.vintages) ? obj.vintages : []) {
    const r = (item ?? {}) as Record<string, unknown>;
    if (r.vintage_id === vintageId && typeof r.why === 'string') return r.why.trim().slice(0, 800);
  }
  return '';
}
