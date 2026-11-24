// What the Tonight sommelier asks Claude, and the shape of the answer.
// Plain TypeScript with no Deno or Node APIs, so the app's tests can import it too.

export const MODEL = 'claude-opus-5-5';

/** Most bottles sent per ask. The app sends its own best matches first. */
export const MAX_CANDIDATES = 80;
export const MAX_PICKS = 4;

/** One bottle the owner could open tonight, as the app describes it. */
export type Candidate = {
  id: string;
  name: string;
  vintage: number | null;
  place: string;
  colour: string | null;
  body: string | null;
  grapes: string[];
  /** "2018-2034" or "". */
  window: string;
  /** "At its peak", "Drink soon"... */
  ready: string;
  score: string | null;
  bottles: number;
};

export type Suggestion = { picks: { id: string; why: string }[]; note: string | null };

export const SUGGESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks', 'note'],
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'why'],
        properties: { id: { type: 'string' }, why: { type: 'string' } },
      },
    },
    note: { type: ['string', 'null'] },
  },
} as const;

export const SYSTEM = `You are the private sommelier for one collector's wine cellar. They tell you what they are eating or in the mood for tonight, and you choose from the bottles they own.

Rules:
- Choose only from the bottles listed, by their id. Never suggest a wine that is not listed.
- Pick up to ${MAX_PICKS} bottles, best first. Fewer is fine when only one or two truly fit.
- Weigh, in this order: what suits the food or mood they describe; how ready the bottle is tonight (prefer "Drink soon" and "At its peak"; avoid "Drink up: past its window" unless it clearly fits); quality (score).
- If they name a style, region, grape or occasion, honour it.
- When the owner's palate is given, prefer bottles that fit it, as a tie-breaker after food and readiness. If they ask to be surprised, choose good bottles outside their usual favourites instead. Never mention the profile itself.
- "why" is one short sentence (under 20 words) in plain, warm language a non-expert enjoys: why this bottle with this dish tonight. No scores, no drinking-window years, no source names.
- "note" is optional: one short sentence of serving advice that applies to the whole answer (decanting, temperature), or null.
- If the ask is not about choosing a wine to drink, return no picks and a short friendly note.`;

function line(c: Candidate): string {
  return [
    c.id,
    `${c.name} ${c.vintage ?? 'NV'}`,
    c.place,
    [c.colour, c.body ? `${c.body} body` : null].filter(Boolean).join(', '),
    c.grapes.join('/'),
    c.ready,
    c.score ? `${c.score} pts` : '',
    `${c.bottles} btl`,
  ].join(' | ');
}

export function userText(ask: string, candidates: Candidate[], palate?: string): string {
  const taste = palate ? `\nThe owner's palate: ${palate}\n` : '';
  return `Tonight's ask: ${ask}
${taste}
Bottles to choose from (id | wine | place | style | grapes | readiness | score | bottles):
${candidates.map(line).join('\n')}`;
}

/** Validates an incoming candidate from the app; anything malformed is dropped. */
export function cleanCandidate(c: unknown): Candidate | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const str = (v: unknown, max = 200) =>
    typeof v === 'string'
      ? v
          .replace(/\s*[\r\n|]+\s*/g, ' ')
          .trim()
          .slice(0, max)
      : '';
  if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string' || !o.name) return null;
  return {
    id: str(o.id, 64),
    name: str(o.name),
    vintage: typeof o.vintage === 'number' && Number.isInteger(o.vintage) ? o.vintage : null,
    place: str(o.place),
    colour: str(o.colour, 20) || null,
    body: str(o.body, 20) || null,
    grapes: Array.isArray(o.grapes)
      ? o.grapes
          .slice(0, 6)
          .map((g) => str(g, 40))
          .filter(Boolean)
      : [],
    window: str(o.window, 20),
    ready: str(o.ready, 40),
    score: str(o.score, 12) || null,
    bottles: typeof o.bottles === 'number' ? Math.max(0, Math.round(o.bottles)) : 0,
  };
}

/** Keeps only picks of bottles that were offered, each once, at most MAX_PICKS. */
export function cleanSuggestion(raw: unknown, candidates: Candidate[]): Suggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.picks)) return null;
  const offered = new Set(candidates.map((c) => c.id));
  const seen = new Set<string>();
  const picks: Suggestion['picks'] = [];
  for (const p of o.picks) {
    if (!p || typeof p !== 'object') continue;
    const { id, why } = p as Record<string, unknown>;
    if (typeof id !== 'string' || !offered.has(id) || seen.has(id)) continue;
    seen.add(id);
    picks.push({ id, why: typeof why === 'string' ? why.trim().slice(0, 240) : '' });
    if (picks.length >= MAX_PICKS) break;
  }
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 240) : null;
  return { picks, note };
}

/** The palate sentences from the app, kept short and on one line. */
export function cleanPalate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, 1000);
  return t || undefined;
}
