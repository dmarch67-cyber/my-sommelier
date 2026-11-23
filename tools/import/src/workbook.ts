// Reads the cellar workbook into plain rows. No cleanup happens here beyond
// turning exceljs cell values (formulas, rich text, shared formulas) into the
// value Excel last calculated, so the mapper sees exactly what the sheet shows.

import ExcelJS from 'exceljs';

export type CellValue = string | number | boolean | Date | null;

/** Column letters for one sheet's layout. */
export interface SheetLayout {
  sheet: string;
  cellar: CellarSpec;
  /** First row after the column headings (may be a section header). */
  firstDataRow: number;
  lastDataRow: number;
  /** Country / state when the sheet has no section header rows. */
  defaultSection?: string;
  /** When a wine is on several sheets with different regions, this sheet's region is used. */
  regionWins?: boolean;
  cols: {
    marker?: string;
    year: string;
    name: string;
    size?: string;
    region: string;
    score: string;
    price: string;
    qty: string;
    left: string;
    total: string;
    gone: string;
    future: string;
    accolade: string;
    extras?: string[];
  };
}

export interface CellarSpec {
  name: string;
  location: string;
  country_code: string;
  currency: string;
  timezone: string;
  sort_order: number;
}

/** The layout of Dan's My_Wine_Inventory.xlsx, from the Data Steward audit. */
export const LAYOUTS: SheetLayout[] = [
  {
    sheet: 'NCP',
    cellar: {
      name: 'LA home',
      location: 'Los Angeles',
      country_code: 'US',
      currency: 'USD',
      timezone: 'America/Los_Angeles',
      sort_order: 1,
    },
    firstDataRow: 2,
    lastDataRow: 792,
    cols: {
      year: 'B',
      name: 'C',
      region: 'D',
      score: 'E',
      price: 'F',
      qty: 'G',
      left: 'H',
      total: 'I',
      gone: 'J',
      future: 'K',
      accolade: 'M',
    },
  },
  {
    sheet: 'O',
    cellar: {
      name: 'Oregon',
      location: 'Oregon',
      country_code: 'US',
      currency: 'USD',
      timezone: 'America/Los_Angeles',
      sort_order: 2,
    },
    firstDataRow: 2,
    lastDataRow: 52,
    defaultSection: 'OREGON',
    // Dan, 2026-11-23: for wines on both the LA and Oregon sheets, use the Oregon tab's region.
    regionWins: true,
    cols: {
      year: 'B',
      name: 'C',
      region: 'D',
      score: 'E',
      price: 'F',
      qty: 'G',
      left: 'H',
      total: 'I',
      gone: 'J',
      future: 'K',
      accolade: 'M',
    },
  },
  {
    sheet: 'Paris',
    cellar: {
      name: 'Paris',
      location: 'Paris',
      country_code: 'FR',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      sort_order: 3,
    },
    firstDataRow: 2,
    lastDataRow: 63,
    cols: {
      marker: 'A',
      year: 'B',
      name: 'C',
      size: 'D',
      region: 'E',
      score: 'F',
      price: 'G',
      qty: 'H',
      left: 'I',
      total: 'J',
      gone: 'K',
      future: 'L',
      accolade: 'U',
      extras: ['N', 'O', 'P', 'Q', 'R'],
    },
  },
];

export interface RawCell {
  value: CellValue;
  formula?: string;
}

export type RawRow = Record<string, RawCell>;

export interface RawSheet {
  layout: SheetLayout;
  /** Data rows (firstDataRow..lastDataRow), keyed by row number. */
  rows: Map<number, RawRow>;
  /** Rows after lastDataRow: the sheet's own totals, used to reconcile. */
  summaryRows: Map<number, RawRow>;
}

function toValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) {
      const r = (v as { result?: ExcelJS.CellValue }).result;
      if (r && typeof r === 'object' && 'error' in r) return null;
      return toValue(r ?? null);
    }
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text);
    if ('error' in v) return null;
  }
  return String(v);
}

function readCell(cell: ExcelJS.Cell): RawCell {
  const v = cell.value;
  const out: RawCell = { value: toValue(v) };
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const f = (v as { formula?: string; sharedFormula?: string }).formula;
    if (f) out.formula = f;
    else if ((v as { sharedFormula?: string }).sharedFormula) out.formula = cell.formula;
  }
  return out;
}

function readRow(ws: ExcelJS.Worksheet, r: number): RawRow {
  const row = ws.getRow(r);
  const out: RawRow = {};
  row.eachCell({ includeEmpty: false }, (cell) => {
    const col = cell.address.replace(/\d+$/, '');
    out[col] = readCell(cell);
  });
  return out;
}

export async function readWorkbook(
  input: string | Buffer | ArrayBuffer,
  layouts: SheetLayout[] = LAYOUTS,
): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  if (typeof input === 'string') await wb.xlsx.readFile(input);
  else await wb.xlsx.load(input as ArrayBuffer);

  return layouts.map((layout) => {
    const ws = wb.getWorksheet(layout.sheet);
    if (!ws) throw new Error(`Workbook has no sheet named "${layout.sheet}"`);
    const rows = new Map<number, RawRow>();
    const summaryRows = new Map<number, RawRow>();
    for (let r = layout.firstDataRow; r <= layout.lastDataRow; r++) rows.set(r, readRow(ws, r));
    for (let r = layout.lastDataRow + 1; r <= ws.rowCount; r++) {
      const row = readRow(ws, r);
      if (Object.keys(row).length) summaryRows.set(r, row);
    }
    return { layout, rows, summaryRows };
  });
}
