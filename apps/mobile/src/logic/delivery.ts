/**
 * Reads a delivery spreadsheet (already turned into rows of text) into lines
 * to add. It finds the heading row by its column names, so the columns can be
 * in any order, and it is forgiving about names ("Qty", "Bottles", "Vintage",
 * "Year"...). Lines it can't read are listed with the reason, never guessed.
 */
import { parseScore } from './adding.ts';

export type DeliveryLine = {
  row: number; // 1-based row in the sheet, for Dan to find it
  wineName: string;
  vintage: number | null;
  quantity: number;
  sizeMl: number;
  unitPrice: number | null;
  region: string | null;
  country: string | null;
  score: ReturnType<typeof parseScore>;
};

export type DeliveryParse = {
  lines: DeliveryLine[];
  skipped: { row: number; reason: string }[];
  /** The columns found, for the preview ("Wine → C, Qty → G"). */
  columns: Partial<Record<Field, string>>;
  error: string | null;
};

type Field = 'wine' | 'vintage' | 'quantity' | 'size' | 'price' | 'region' | 'country' | 'score';

const HEADINGS: Record<Field, RegExp> = {
  wine: /^(wine|wine name|name|description|label|product|item)$/,
  vintage: /^(vintage|year|vtg|yr)$/,
  quantity: /^(qty|quantity|bottles|btls?|count|units|#|no|number)$/,
  size: /^(size|format|bottle size|ml|volume)$/,
  price: /^(price|cost|unit price|price per bottle|each|\$|usd|eur|bottle price)$/,
  region: /^(region|appellation|area|sub region)$/,
  country: /^(country)$/,
  score: /^(score|rp|points|pts|rating|ws|wa|vinous)$/,
};

function clean(s: unknown): string {
  return String(s ?? '').trim();
}

function headingKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9#$ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function colLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function parseSize(text: string): number | null {
  const t = text.toLowerCase().replace(/\s/g, '');
  if (!t) return null;
  if (/magnum|^1\.5l?$|^1500(ml)?$/.test(t)) return /double/.test(t) ? 3000 : 1500;
  if (/half|^375(ml)?$|^0?\.375l?$/.test(t)) return 375;
  if (/^750(ml)?$|^0?\.75l?$|^std|standard|bottle/.test(t)) return 750;
  if (/^3l?$|^3000(ml)?$/.test(t)) return 3000;
  const ml = t.match(/^(\d{3,4})ml$/);
  if (ml) return Number(ml[1]);
  const l = t.match(/^(\d(?:\.\d+)?)l$/);
  if (l) return Math.round(Number(l[1]) * 1000);
  return null;
}

function parseMoney(text: string): number | null {
  const t = text
    .replace(/[^0-9.,-]/g, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function parseDelivery(rows: string[][]): DeliveryParse {
  // Heading row: the first row (in the top 15) that has a wine column and a quantity column.
  let headerRow = -1;
  let map: Partial<Record<Field, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const found: Partial<Record<Field, number>> = {};
    rows[r].forEach((cell, c) => {
      const key = headingKey(clean(cell));
      for (const f of Object.keys(HEADINGS) as Field[]) {
        if (found[f] === undefined && HEADINGS[f].test(key)) found[f] = c;
      }
    });
    if (found.wine !== undefined && found.quantity !== undefined) {
      headerRow = r;
      map = found;
      break;
    }
  }
  const columns: DeliveryParse['columns'] = {};
  for (const [f, c] of Object.entries(map)) columns[f as Field] = colLetter(c as number);

  if (headerRow < 0) {
    return {
      lines: [],
      skipped: [],
      columns,
      error:
        'Couldn’t find the column headings. The sheet needs a row with at least a “Wine” column and a “Qty” (or “Bottles”) column.',
    };
  }

  const lines: DeliveryLine[] = [];
  const skipped: DeliveryParse['skipped'] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (f: Field) => (map[f] === undefined ? '' : clean(row[map[f]!]));
    let wineName = get('wine');
    const qtyText = get('quantity');
    if (!wineName && !qtyText) continue; // blank row
    if (/^(total|subtotal|sum)\b/i.test(wineName) || /^(total|subtotal)\b/i.test(clean(row[0])))
      continue;
    if (!wineName) {
      skipped.push({ row: r + 1, reason: 'No wine name' });
      continue;
    }
    const quantity = Number(qtyText.replace(/[^0-9.]/g, ''));
    if (!qtyText || !Number.isInteger(quantity) || quantity <= 0) {
      skipped.push({ row: r + 1, reason: `No bottle count for “${wineName}”` });
      continue;
    }

    // Size from its column, else from the name ("Latour 1.5L", "(magnum)").
    let sizeMl = parseSize(get('size')) ?? null;
    const inName = wineName.match(
      /\s*[([]?\b(1\.5 ?l|magnum|mag|3 ?l|375 ?ml|half bottle)\b[)\]]?\s*$/i,
    );
    if (inName) {
      sizeMl = sizeMl ?? parseSize(inName[1].replace(/^mag$/i, 'magnum'));
      wineName = wineName.slice(0, inName.index).trim();
    }

    // Vintage from its column, else a year at the start or end of the name.
    let vintage: number | null = null;
    const vText = get('vintage');
    if (/^nv$/i.test(vText)) vintage = null;
    else if (/^(19|20)\d{2}$/.test(vText.replace(/\.0$/, ''))) vintage = Number(vText.slice(0, 4));
    else {
      const y = wineName.match(/^((?:19|20)\d{2})\s+|\s+((?:19|20)\d{2})$/);
      if (y) {
        vintage = Number(y[1] ?? y[2]);
        wineName = wineName.replace(y[0], ' ').trim();
      }
    }

    lines.push({
      row: r + 1,
      wineName,
      vintage,
      quantity,
      sizeMl: sizeMl ?? 750,
      unitPrice: parseMoney(get('price')),
      region: get('region') || null,
      country: get('country') || null,
      score: parseScore(get('score')),
    });
  }
  return {
    lines,
    skipped,
    columns,
    error:
      lines.length === 0 && skipped.length === 0
        ? 'The sheet has no wine lines under the headings.'
        : null,
  };
}

/** Splits CSV text into rows (handles quotes and commas inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const sep =
    (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
