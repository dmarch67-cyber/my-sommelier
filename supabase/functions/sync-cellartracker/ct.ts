// Reading a CellarTracker export and matching it to the wines in the app.
// Plain TypeScript with no Deno or Node APIs, so the app's tests can import it too.
//
// CellarTracker is used only for facts about each wine (drinking window,
// scores, type, grapes). Its bottle counts are never used: the app is the
// record of what is in the cellar.

/** The official personal export: one row per wine in the CellarTracker cellar. */
export function exportUrl(user: string, password: string, table = 'List'): string {
  const q = new URLSearchParams({ User: user, Password: password, Format: 'csv', Table: table });
  return `https://www.cellartracker.com/xlquery.asp?${q}`;
}

/** Parses CSV (quoted fields, doubled quotes, CRLF) into objects keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((f) => f.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** True when the response looks like the export (a header with Wine and Vintage), not a login page. */
export function looksLikeExport(rows: Record<string, string>[]): boolean {
  return rows.length > 0 && 'Wine' in rows[0] && 'Vintage' in rows[0];
}

// Score columns in the export, by the app's score source names. Columns not
// listed are ignored; MY (the owner's own score) is left out on purpose.
export const SCORE_COLUMNS: Record<string, { source: string; detail: string }> = {
  CT: { source: 'cellartracker', detail: 'CellarTracker community' },
  AG: { source: 'vinous', detail: 'Vinous (Antonio Galloni)' },
  IWC: { source: 'vinous', detail: 'Vinous (IWC / Tanzer)' },
  WA: { source: 'wine_advocate', detail: 'Wine Advocate' },
  WS: { source: 'wine_spectator', detail: 'Wine Spectator' },
  JR: { source: 'jancis_robinson', detail: 'Jancis Robinson' },
  BH: { source: 'burghound', detail: 'Burghound' },
  JS: { source: 'james_suckling', detail: 'James Suckling' },
  JD: { source: 'jeb_dunnuck', detail: 'Jeb Dunnuck' },
  DEC: { source: 'decanter', detail: 'Decanter' },
  WE: { source: 'other', detail: 'Wine Enthusiast' },
  JG: { source: 'other', detail: 'John Gilman' },
};

export type CtScore = {
  source: string;
  source_detail: string;
  raw_value: string;
  value_low: number;
  value_high: number | null;
  is_plus: boolean;
};

/** "94", "94+", "92-94", "92–94+" → a score; anything else → null. */
export function parseScore(raw: string): Omit<CtScore, 'source' | 'source_detail'> | null {
  const s = raw.trim();
  const m = s.match(/^(\d{1,3}(?:\.\d+)?)(?:\s*[-–]\s*(\d{1,3}(?:\.\d+)?))?\s*(\+)?$/);
  if (!m) return null;
  const low = Number(m[1]);
  const high = m[2] != null ? Number(m[2]) : null;
  if (!(low > 0 && low <= 100) || (high != null && (high < low || high > 100))) return null;
  return { raw_value: s, value_low: low, value_high: high, is_plus: m[3] === '+' };
}

const COLOURS: Record<string, string> = {
  red: 'red',
  white: 'white',
  rosé: 'rose',
  rose: 'rose',
  sparkling: 'sparkling',
  'white - sparkling': 'sparkling',
  'rosé - sparkling': 'sparkling',
  'red - sparkling': 'sparkling',
  'white - sweet/dessert': 'sweet',
  'red - sweet/dessert': 'sweet',
  dessert: 'sweet',
  'white - fortified': 'fortified',
  'red - fortified': 'fortified',
  fortified: 'fortified',
};

/** The app's colour for a CellarTracker row (Type, then Color/Category). */
export function ctColour(row: Record<string, string>): string | null {
  const type = (row.Type ?? '').toLowerCase().trim();
  if (COLOURS[type]) return COLOURS[type];
  const cat = (row.Category ?? '').toLowerCase();
  if (cat.includes('sparkling')) return 'sparkling';
  if (cat.includes('dessert') || cat.includes('sweet')) return 'sweet';
  if (cat.includes('fortified')) return 'fortified';
  return COLOURS[(row.Color ?? '').toLowerCase().trim()] ?? null;
}

const STOP = new Set([
  'chateau',
  'domaine',
  'dom',
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'l',
  'd',
  'the',
  'and',
  'et',
  'di',
  'del',
  'della',
  'estate',
  'winery',
  'vineyards',
  'vineyard',
  'wines',
  'cellars',
]);

/** Name → comparable words: accents, "Château", punctuation and filler words dropped. */
export function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

/** CellarTracker marks non-vintage wines as 1001. */
export function ctYear(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1800 && n <= 2200 ? n : null;
}

export type AppVintage = { vintage_id: string; wine_name: string; year: number | null };

export type CtMatch = {
  vintage_id: string;
  ct_id: string | null;
  colour: string | null;
  grapes: string[];
  drink_from: number | null;
  drink_to: number | null;
  scores: CtScore[];
};

/**
 * How well a CellarTracker name fits an app name, 0..1. Every word of the
 * app's (usually shorter) name should appear in CellarTracker's, and the two
 * should share most of their words.
 */
export function nameFit(appName: string, ctName: string): number {
  const a = new Set(words(appName));
  const b = new Set(words(ctName));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const coverApp = shared / a.size;
  const jaccard = shared / (a.size + b.size - shared);
  if (coverApp < 0.75 || jaccard < 0.35) return 0;
  return (coverApp + jaccard) / 2;
}

/** The facts in one export row, in the shape apply_cellartracker() takes. */
export function rowFacts(row: Record<string, string>): Omit<CtMatch, 'vintage_id'> {
  const from = ctYear(row.BeginConsume ?? '');
  const to = ctYear(row.EndConsume ?? '');
  const scores: CtScore[] = [];
  for (const [col, meta] of Object.entries(SCORE_COLUMNS)) {
    const parsed = row[col] ? parseScore(row[col]) : null;
    if (parsed) scores.push({ source: meta.source, source_detail: meta.detail, ...parsed });
  }
  const grapes = (row.MasterVarietal || row.Varietal || '')
    .split(/\s*(?:,|\/| and | & )\s*/)
    .map((g) => g.trim())
    .filter((g) => g && !/blend/i.test(g))
    .slice(0, 4);
  return {
    ct_id: row.iWine || null,
    colour: ctColour(row),
    grapes,
    drink_from: from != null && to != null && to >= from ? from : null,
    drink_to: from != null && to != null && to >= from ? to : null,
    scores,
  };
}

/**
 * Matches export rows to the app's vintages: same year (or both non-vintage)
 * and the best-fitting name. A vintage with two nearly equal candidates is
 * left unmatched rather than guessed.
 */
export function matchRows(
  rows: Record<string, string>[],
  vintages: AppVintage[],
): { matches: CtMatch[]; unmatchedApp: number; unmatchedCt: number } {
  const byYear = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const key = String(ctYear(r.Vintage ?? ''));
    byYear.set(key, [...(byYear.get(key) ?? []), r]);
  }
  const used = new Set<Record<string, string>>();
  const matches: CtMatch[] = [];
  for (const v of vintages) {
    const candidates = byYear.get(String(v.year)) ?? [];
    let best: Record<string, string> | null = null;
    let bestFit = 0;
    let secondFit = 0;
    for (const r of candidates) {
      const ctName = r.Wine || [r.Producer, r.Designation].filter(Boolean).join(' ');
      const fit = nameFit(v.wine_name, ctName);
      if (fit > bestFit) {
        if (best && best.iWine !== r.iWine) secondFit = bestFit;
        best = r;
        bestFit = fit;
      } else if (fit > secondFit && r.iWine !== best?.iWine) secondFit = fit;
    }
    // Two CellarTracker wines that fit almost equally well (e.g. a generic
    // "Pinot Noir" in the app against two single-vineyard bottlings) are
    // left unmatched rather than guessed.
    const tie = secondFit > 0 && bestFit - secondFit < 0.15;
    if (!best || tie) continue;
    used.add(best);
    matches.push({ vintage_id: v.vintage_id, ...rowFacts(best) });
  }
  return {
    matches,
    unmatchedApp: vintages.length - matches.length,
    unmatchedCt: rows.filter((r) => !used.has(r)).length,
  };
}
