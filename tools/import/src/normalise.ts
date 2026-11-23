// Cleanup rules from the Data Steward audit. Each function is pure so it can
// be unit tested, and the mapper records every value it changes.

/** Section header rows (column C) to country and US state. */
export const SECTIONS: Record<string, { country: string; region?: string }> = {
  FRANCE: { country: 'France' },
  SPAIN: { country: 'Spain' },
  ITALY: { country: 'Italy' },
  AUSTRALIA: { country: 'Australia' },
  CALIFORNIA: { country: 'USA', region: 'California' },
  OREGON: { country: 'USA', region: 'Oregon' },
  WASHINGTON: { country: 'USA', region: 'Washington' },
};

interface Place {
  /** Appellation or sub-region; null when the sheet only names a broad region. */
  appellation: string | null;
  /** Broad region or US state. */
  region: string | null;
}

/**
 * Every region spelling in the workbook, folded to one name. The key is the
 * spelling after `regionKey()` (upper case, no accents or punctuation).
 */
export const PLACES: Record<string, Place> = {
  // Bordeaux
  'ST EMILION': { appellation: 'Saint-Émilion', region: 'Bordeaux' },
  'ST JULIEN': { appellation: 'Saint-Julien', region: 'Bordeaux' },
  'ST ESTEPHE': { appellation: 'Saint-Estèphe', region: 'Bordeaux' },
  PAUILLAC: { appellation: 'Pauillac', region: 'Bordeaux' },
  PAULLIAC: { appellation: 'Pauillac', region: 'Bordeaux' },
  MARGAUX: { appellation: 'Margaux', region: 'Bordeaux' },
  'PESSAC LEOGNAN': { appellation: 'Pessac-Léognan', region: 'Bordeaux' },
  POMEROL: { appellation: 'Pomerol', region: 'Bordeaux' },
  'LALANDE DE POMEROL': { appellation: 'Lalande-de-Pomerol', region: 'Bordeaux' },
  'HAUT MEDOC': { appellation: 'Haut-Médoc', region: 'Bordeaux' },
  MEDOC: { appellation: 'Médoc', region: 'Bordeaux' },
  MOULIS: { appellation: 'Moulis-en-Médoc', region: 'Bordeaux' },
  'MOULIS EN MEDOC': { appellation: 'Moulis-en-Médoc', region: 'Bordeaux' },
  'LISTRAC MEDOC': { appellation: 'Listrac-Médoc', region: 'Bordeaux' },
  SAUTERNES: { appellation: 'Sauternes', region: 'Bordeaux' },
  // Rhône and Provence
  CHATEAUNEUF: { appellation: 'Châteauneuf-du-Pape', region: 'Rhône' },
  CORNAS: { appellation: 'Cornas', region: 'Rhône' },
  GIGONDAS: { appellation: 'Gigondas', region: 'Rhône' },
  BANDOL: { appellation: 'Bandol', region: 'Provence' },
  // Burgundy
  BURGUNDY: { appellation: null, region: 'Burgundy' },
  'GEVREY CHAMBERTIN': { appellation: 'Gevrey-Chambertin', region: 'Burgundy' },
  'MOREY SAINT DENIS': { appellation: 'Morey-Saint-Denis', region: 'Burgundy' },
  POMMARD: { appellation: 'Pommard', region: 'Burgundy' },
  'HAUT COTE DE NUIT': { appellation: 'Bourgogne Hautes-Côtes de Nuits', region: 'Burgundy' },
  // Spain
  'RIBERA DEL DUERO': { appellation: 'Ribera del Duero', region: 'Castilla y León' },
  'SARDON DEL DUERO': { appellation: 'Sardón de Duero', region: 'Castilla y León' },
  'SARDON DEL DEUERO': { appellation: 'Sardón de Duero', region: 'Castilla y León' },
  TORO: { appellation: 'Toro', region: 'Castilla y León' },
  'ARROYO DEL TORTOLAS': { appellation: 'Arroyo del Tortolas', region: null },
  'CAMPO DE BORJA': { appellation: 'Campo de Borja', region: 'Aragón' },
  JUMILLA: { appellation: 'Jumilla', region: 'Murcia' },
  PRIORAT: { appellation: 'Priorat', region: 'Catalonia' },
  RIOJA: { appellation: 'Rioja', region: 'Rioja' },
  // Italy: the sheet names regions only
  PIEDMONT: { appellation: null, region: 'Piedmont' },
  TUSCANY: { appellation: null, region: 'Tuscany' },
  VENETO: { appellation: null, region: 'Veneto' },
  // California
  'NAPA VALLEY': { appellation: 'Napa Valley', region: 'California' },
  'PASO ROBLES': { appellation: 'Paso Robles', region: 'California' },
  'CENTRAL COAST': { appellation: 'Central Coast', region: 'California' },
  'SANTA CRUZ': { appellation: 'Santa Cruz', region: 'California' },
  'SANTA MARIA': { appellation: 'Santa Maria', region: 'California' },
  SONOMA: { appellation: 'Sonoma', region: 'California' },
  // Oregon
  'DUNDEE HILLS': { appellation: 'Dundee Hills', region: 'Oregon' },
  'EOLA AMITY': { appellation: 'Eola-Amity Hills', region: 'Oregon' },
  'RIBBON RIDGE': { appellation: 'Ribbon Ridge', region: 'Oregon' },
  'WILLAMETTE VALLEY': { appellation: 'Willamette Valley', region: 'Oregon' },
  'YAMHILL CARLTON': { appellation: 'Yamhill-Carlton', region: 'Oregon' },
  // Washington (also appears on the Oregon sheet)
  'WALLA WALLA': { appellation: 'Walla Walla Valley', region: 'Washington' },
  // Australia
  'BAROSSA VALLEY': { appellation: 'Barossa Valley', region: 'South Australia' },
  'MCLAREN VALE': { appellation: 'McLaren Vale', region: 'South Australia' },
};

/** Upper case, accents and punctuation removed, spaces collapsed. */
export function foldKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&]+/g, ' ')
    .trim();
}

export function regionKey(raw: string): string {
  return foldKey(raw);
}

export function lookupPlace(raw: string): Place | undefined {
  return PLACES[regionKey(raw)];
}

/** Trim and collapse runs of whitespace (the sheet has trailing and double spaces). */
export function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const SIZE_IN_NAME = /\s*\b1[.,]5\s*L\b\.?/i;

/** Splits a "… 1.5L" marker off a wine name. */
export function splitSizeFromName(name: string): { name: string; sizeMl: number | null } {
  if (SIZE_IN_NAME.test(name)) {
    return { name: cleanText(name.replace(SIZE_IN_NAME, ' ')), sizeMl: 1500 };
  }
  return { name, sizeMl: null };
}

/** Paris column D is litres (0.75, 1.5). */
export function litresToMl(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 1000);
}

// Words that stay as written in a display name.
const KEEP_UPPER = new Set(['PS', 'XO', 'VGW', 'II', 'III', 'IV', 'VV', 'MV', 'USA']);
const LOWER_MID = new Set([
  'de',
  'du',
  'des',
  'del',
  'di',
  'da',
  'et',
  'y',
  'e',
  'en',
  'of',
  'and',
]);

function capitalise(word: string): string {
  // Capitalise after start, hyphen, and after a one-letter elision (D', L').
  return word
    .toLowerCase()
    .replace(/(^|[-/(])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(
      /(^|[-\s])(\p{L})(['’])(\p{L})/gu,
      (_, p: string, a: string, q: string, c: string) => p + a.toUpperCase() + q + c.toUpperCase(),
    );
}

/** "CLOS L'ORATOIRE" -> "Clos L'Oratoire". Display only; the raw string is kept. */
export function titleCase(s: string): string {
  return cleanText(s)
    .split(' ')
    .map((w, i) => {
      if (KEEP_UPPER.has(w.toUpperCase()) || /\d/.test(w)) return w.toUpperCase();
      const lower = w.toLowerCase();
      if (i > 0 && LOWER_MID.has(lower)) return lower;
      return capitalise(w);
    })
    .join(' ')
    .replace(/-(Du|De|Des|En|Sur|Les|La|Le|Et)-/g, (m) => m.toLowerCase());
}

/**
 * Key used to recognise the same wine across sheets: accents, punctuation and
 * a leading "Château" dropped, so "BARDE-HAUT" and "CHATEAU BARDE-HAUT" match.
 */
export function wineMatchKey(name: string, country: string | null): string {
  const folded = foldKey(name).replace(/^(CHATEAU|CH)\s+/, '');
  return `${country ?? ''}|${folded}`;
}

export interface ParsedScore {
  raw: string;
  low: number | null;
  high: number | null;
  plus: boolean;
  barrel: boolean;
  parsed: boolean;
}

/** "94" | 94 | "94+" | "92-94". Blank -> null (no score row). */
export function parseScore(v: unknown): ParsedScore | null {
  if (v === null || v === undefined) return null;
  const raw = cleanText(String(v));
  if (!raw) return null;
  let m = /^(\d{2,3}(?:\.\d+)?)(\+)?$/.exec(raw);
  if (m) {
    return { raw, low: Number(m[1]), high: null, plus: !!m[2], barrel: false, parsed: true };
  }
  m = /^(\d{2,3})\s*[-–]\s*(\d{2,3})(\+)?$/.exec(raw);
  if (m) {
    const low = Number(m[1]);
    const high = Number(m[2]);
    if (high >= low) return { raw, low, high, plus: !!m[3], barrel: true, parsed: true };
  }
  return { raw, low: null, high: null, plus: false, barrel: false, parsed: false };
}

export interface ParsedAccolade {
  raw: string;
  publication: string | null;
  title: string | null;
  rank: number | null;
  year: number | null;
}

const PUBLICATIONS: Record<string, string> = {
  WS: 'Wine Spectator',
  VINOUS: 'Vinous',
  WA: 'Wine Advocate',
  JS: 'James Suckling',
  DECANTER: 'Decanter',
  WE: 'Wine Enthusiast',
};

/** "WS #2 WOY 2018" -> Wine Spectator, Wine of the Year list, rank 2, 2018. */
export function parseAccolade(v: unknown): ParsedAccolade | null {
  if (v === null || v === undefined) return null;
  const raw = cleanText(String(v));
  if (!raw) return null;
  const m = /^([A-Z]+)\s*#\s*(\d+)\s+(WOY|TOP\s*100)\s+(\d{4})$/i.exec(raw);
  if (m) {
    return {
      raw,
      publication: PUBLICATIONS[m[1].toUpperCase()] ?? m[1],
      title: /WOY/i.test(m[3]) ? 'Wine of the Year' : 'Top 100',
      rank: Number(m[2]),
      year: Number(m[4]),
    };
  }
  return { raw, publication: null, title: null, rank: null, year: null };
}

/** A count cell: number, or blank / a stray space meaning 0. */
export function parseCount(v: unknown): { value: number; ok: boolean } {
  if (v === null || v === undefined) return { value: 0, ok: true };
  if (typeof v === 'number') return { value: v, ok: Number.isInteger(v) && v >= 0 };
  const s = String(v).trim();
  if (!s) return { value: 0, ok: true };
  const n = Number(s);
  return { value: Number.isFinite(n) ? n : 0, ok: Number.isInteger(n) && n >= 0 };
}

/** Price per bottle: 0 and blank mean unknown (null), not free. */
export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$€,\s]/g, ''));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}
