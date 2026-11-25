// What the "What critics and drinkers say" rewrite asks Claude, and how the
// link to the full notes is chosen. Plain TypeScript with no Deno or Node
// APIs, so the app's tests can import it too.

export const MODEL = 'claude-haiku-5-5';

export type ScoreIn = { source: string; source_detail: string | null; raw_value: string };
export type VintageIn = {
  vintage_id: string;
  year: number | null;
  maturity: string | null;
  recent_notes: number;
  latest_note_year: number | null;
  /** The drinking-window review's own summary (written to explain the window). */
  summary: string | null;
  scores: ScoreIn[];
  /** Notes by critics and other tasters found on public web pages (gather-notes). */
  notes?: NoteIn[];
};
export type NoteIn = {
  author: string;
  kind: string;
  score: string | null;
  noted_on: string | null;
  note: string;
};
export type WineIn = {
  name: string;
  producer: string | null;
  place: string;
  vintages: VintageIn[];
};
export type Source = { url: string; title: string };

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vintages'],
  properties: {
    vintages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['vintage_id', 'text'],
        properties: { vintage_id: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
} as const;

export const SYSTEM = `You write the "What critics and drinkers say" section of a private wine-cellar app. The owner reads it on a wine's page to decide whether to open a bottle.

For each vintage you get the notes of an earlier review, which summarised recent critic and community tasting notes in order to set a drinking window, and often published tasting notes by critics, merchants and the winery, quoted word for word. Write the section for the owner from both:
- Two or three short sentences, at most 60 words.
- Say what the wine is like (fruit, structure, style) and how it is drinking now, and say who said so: "CellarTracker drinkers", "Jeb Dunnuck", "Vinous", "a 2025 note" and so on.
- Use only what the review and the published notes say. Never add a flavour, score, critic or opinion they do not give. Lean on the critics' published notes for what the wine is like, and on the review for how it is drinking now. A winery's own note is not an independent opinion; use it only for style.
- Never comment on how old or how many the notes are, and never say there are no recent notes or that newer notes may exist elsewhere (the page shows the date of the latest note). Just say what the notes and critics said.
- Do not give drinking dates or say how long it will keep (the page already shows them); just say how it is drinking now, for example "ready to drink", "still needs time" or "drink soon".
- Never use the word "window" and do not mention the review itself, "the digest", confidence, what the review had to rely on, or Vivino.
- Name who said it when the review does (for example "CellarTracker drinkers" or "Jeb Dunnuck"); otherwise "a 2025 note" is fine.
- Plain, warm English. No em dashes, no lists, no headings.

Return one entry for every vintage listed.`;

function scoreLine(s: ScoreIn): string {
  const who = s.source_detail?.replace(/^CellarTracker export:\s*/, '') || s.source;
  return `${who} ${s.raw_value}`;
}

export function userText(w: WineIn): string {
  const lines = [
    `Wine: ${w.name}${w.producer ? ` (producer ${w.producer})` : ''}${w.place ? `, ${w.place}` : ''}`,
    '',
  ];
  for (const v of w.vintages) {
    lines.push(`vintage_id ${v.vintage_id}: ${v.year ?? 'NV'}`);
    lines.push(
      `  recent notes found: ${v.recent_notes}${v.latest_note_year ? ` (latest ${v.latest_note_year})` : ''}` +
        (v.maturity ? `; maturity now: ${v.maturity.replace('_', ' ')}` : ''),
    );
    if (v.scores.length) lines.push(`  scores: ${v.scores.map(scoreLine).join('; ')}`);
    lines.push(`  review: ${v.summary ?? '(none)'}`);
    for (const n of (v.notes ?? []).slice(0, 8)) {
      const head = [n.author, n.score, n.noted_on].filter(Boolean).join(', ');
      const body = n.note.length > 500 ? n.note.slice(0, 500) + '…' : n.note;
      lines.push(`  published note (${n.kind}; ${head}): ${body}`);
    }
  }
  return lines.join('\n');
}

/** Checks Claude's answer: only the vintages asked about, trimmed, no Vivino. */
export function cleanAnswer(raw: unknown, w: WineIn): { vintage_id: string; text: string }[] {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const asked = new Set(w.vintages.map((v) => v.vintage_id));
  const out = new Map<string, string>();
  for (const item of Array.isArray(obj.vintages) ? obj.vintages : []) {
    const r = item as Record<string, unknown>;
    if (!r || typeof r.vintage_id !== 'string' || !asked.has(r.vintage_id)) continue;
    if (typeof r.text !== 'string') continue;
    const text = r.text
      .replace(/\s*—\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();
    // Drinking dates belong to the window above it, so a summary naming one is redone.
    if (
      !text ||
      /vivino|\bwindow\b|\b20[3-9]\d|no recent (tasting )?notes|notes we could find|may have (newer|some)|recent notes online/i.test(
        text,
      )
    )
      continue;
    out.set(r.vintage_id, text.slice(0, 600));
  }
  return [...out.entries()].map(([vintage_id, text]) => ({ vintage_id, text }));
}

// ---------------------------------------------------------------------------
// The link to the full notes.

const COMMON = new Set([
  'chateau',
  'domaine',
  'vineyard',
  'vineyards',
  'estate',
  'winery',
  'wines',
  'cuvee',
  'reserve',
  'grand',
  'vino',
]);

function words(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length >= 3 && !COMMON.has(x));
}

/** CellarTracker's search for this wine and vintage (all wines, not just a cellar). */
export function searchUrl(name: string, year: number | null): string {
  const q = [name, year].filter(Boolean).join(' ');
  return `https://www.cellartracker.com/list.asp?Table=List&iUserOverride=0&szSearch=${encodeURIComponent(q)}`;
}

/** The CellarTracker page for a CellarTracker wine id (iWine), or null if it is not one. */
export function wineUrl(ctId: string | null | undefined): string | null {
  return ctId && /^\d+$/.test(ctId.trim())
    ? `https://www.cellartracker.com/wine.asp?iWine=${ctId.trim()}`
    : null;
}

/**
 * The CellarTracker page for this exact vintage: first the id from the owner's
 * own CellarTracker export, then a page the review read whose title
 * starts with the year and closely matches the wine's name. Otherwise a
 * CellarTracker search for the wine and vintage.
 */
export function notesUrl(
  name: string,
  year: number | null,
  sources: Source[],
  ctId?: string | null,
): string {
  const own = wineUrl(ctId);
  if (own) return own;
  if (year != null) {
    const want = [...new Set(words(name))];
    let best: { url: string; score: number } | null = null;
    for (const s of sources) {
      if (!/^https:\/\/(www\.)?cellartracker\.com\/wine\.asp\?iWine=\d+/i.test(s.url)) continue;
      if (!s.title.trim().startsWith(`${year} `)) continue;
      // How closely the page title matches the wine: shared words over all
      // words, so "Chevalier de Lascombes" does not pass for "Lascombes".
      const have = new Set(words(s.title).filter((x) => x !== 'cellartracker' && x !== `${year}`));
      const shared = want.filter((x) => have.has(x)).length;
      const score = shared / Math.max(1, new Set([...want, ...have]).size);
      if (score >= 0.6 && (!best || score > best.score)) best = { url: s.url, score };
    }
    if (best) return best.url.replace(/^https:\/\/cellartracker/i, 'https://www.cellartracker');
  }
  return searchUrl(name, year);
}
