/**
 * Export to Excel: turns the loaded cellar into the sheets of an .xlsx file.
 * Pure logic (no React, no Supabase), so it is tested in plain Node.
 *
 * Sheet "Bottles": one row per lot (wine + vintage + bottle size + cellar).
 * Sheet "Summary": bottles, magnums, on order and value per cellar. Money is
 * never added across currencies: USD and EUR get their own total lines.
 */
import type { XlsxCell, XlsxSheet } from '../lib/xlsx.ts';
import {
  ALL_CELLARS,
  drinkWindow,
  ripeness,
  scoreLabel,
  sourceName,
  type Cellar,
  type CellarFilter,
  type InventoryRow,
  type Maturity,
  type Score,
  type TastingNote,
} from './cellar.ts';

export type ExportInput = {
  cellars: Cellar[];
  inventory: InventoryRow[];
  scores: Score[];
  notes: TastingNote[];
  maturity: Map<string, Maturity>;
  bestScores: Map<string, Score>;
  filter: CellarFilter;
  /** Today, as YYYY-MM-DD (the file name and the "ready" column use it). */
  today: string;
};

export type ExportResult = { fileName: string; sheets: XlsxSheet[]; bottles: number };

const MATURITY: Record<Maturity, string> = {
  too_young: 'Too young',
  approaching: 'Approaching',
  ready: 'Ready',
  peak: 'At peak',
  declining: 'Declining',
  past_it: 'Past it',
};

const WINDOW_SOURCE: Record<string, string> = {
  blended: 'Blended reviews',
  estimate: 'Estimate',
  cellartracker: 'CellarTracker',
  vinous: 'Vinous',
};

const COLOUR: Record<string, string> = { rose: 'Rosé' };

/** In the file, a score with no known critic is the one from Dan's own spreadsheet. */
const scoreSource = (s: Score) => (s.source === 'unknown' ? 'Spreadsheet' : sourceName(s));

/** "95" becomes a number so the column sorts; "92-94" and "94+" stay as text. */
const scoreCell = (raw: string) => {
  const label = scoreLabel(raw);
  return /^\d+$/.test(label) ? Number(label) : label;
};

const cap = (s: string | null | undefined) =>
  s ? (COLOUR[s] ?? s.charAt(0).toUpperCase() + s.slice(1)) : null;

export const BOTTLE_COLUMNS: XlsxSheet['columns'] = [
  { header: 'Cellar', width: 12 },
  { header: 'Producer', width: 24 },
  { header: 'Wine', width: 44 },
  { header: 'Vintage', width: 9, format: 'text' },
  { header: 'Colour', width: 9 },
  { header: 'Country', width: 11 },
  { header: 'Region', width: 16 },
  { header: 'Sub-region', width: 18 },
  { header: 'Appellation', width: 22 },
  { header: 'Grapes', width: 26 },
  { header: 'Body', width: 9 },
  { header: 'Bottle size', width: 14 },
  { header: 'Size (ml)', width: 10, format: 'integer' },
  { header: 'In cellar', width: 10, format: 'integer' },
  { header: 'On order', width: 10, format: 'integer' },
  { header: 'Price per bottle', width: 15, format: 'money' },
  { header: 'Currency', width: 10 },
  { header: 'Value', width: 13, format: 'money' },
  { header: 'Best score', width: 11 },
  { header: 'Score source', width: 16 },
  { header: 'All scores', width: 34 },
  { header: 'Drink from', width: 11, format: 'text' },
  { header: 'Drink to', width: 10, format: 'text' },
  { header: 'Window from', width: 16 },
  { header: 'Ready?', width: 30 },
  { header: 'Maturity (reviews)', width: 18 },
  { header: 'My last rating (stars)', width: 20 },
  { header: 'Last tasted', width: 12 },
];

export function buildExport(input: ExportInput): ExportResult {
  const { cellars, filter, today } = input;
  const year = Number(today.slice(0, 4));
  const order = new Map(cellars.map((c, i) => [c.id, i]));
  const chosen = filter === ALL_CELLARS ? cellars : cellars.filter((c) => c.id === filter);
  const chosenIds = new Set(chosen.map((c) => c.id));

  const scoresByVintage = new Map<string, Score[]>();
  for (const s of input.scores) {
    const list = scoresByVintage.get(s.vintage_id) ?? [];
    list.push(s);
    scoresByVintage.set(s.vintage_id, list);
  }
  const lastNote = new Map<string, TastingNote>();
  for (const n of input.notes) {
    const cur = lastNote.get(n.vintage_id);
    if (
      !cur ||
      (n.tasted_on ?? '') > (cur.tasted_on ?? '') ||
      (n.tasted_on === cur.tasted_on && n.created_at > cur.created_at)
    )
      lastNote.set(n.vintage_id, n);
  }

  const lots = input.inventory
    .filter((r) => chosenIds.has(r.cellar_id) && (r.quantity > 0 || r.quantity_on_order > 0))
    .sort(
      (a, b) =>
        (order.get(a.cellar_id) ?? 0) - (order.get(b.cellar_id) ?? 0) ||
        a.wine_name.localeCompare(b.wine_name) ||
        (a.vintage ?? 0) - (b.vintage ?? 0) ||
        a.bottle_size_ml - b.bottle_size_ml,
    );

  const rows: XlsxCell[][] = lots.map((r) => {
    const best = input.bestScores.get(r.vintage_id) ?? null;
    const w = drinkWindow(r.drink_from, r.drink_to, best);
    const ownWindow = r.drink_from != null || r.drink_to != null;
    const windowFrom = ownWindow
      ? (WINDOW_SOURCE[r.drink_window_source ?? ''] ?? cap(r.drink_window_source) ?? 'Critic')
      : w.from != null || w.to != null
        ? best
          ? scoreSource(best)
          : null
        : null;
    const ready = ripeness(w.from, w.to, year);
    const price = r.unit_price == null ? null : Number(r.unit_price);
    const allScores = (scoresByVintage.get(r.vintage_id) ?? [])
      .map((s) => `${scoreSource(s)} ${scoreLabel(s.raw_value)}`)
      .join('; ');
    const note = lastNote.get(r.vintage_id);
    const maturity = input.maturity.get(r.vintage_id);
    return [
      r.cellar_name,
      r.producer,
      r.wine_name,
      r.vintage == null ? 'NV' : String(r.vintage),
      cap(r.colour),
      r.country,
      r.region,
      r.sub_region ?? null,
      r.appellation,
      (r.grapes ?? []).join(', ') || null,
      cap(r.body),
      r.bottle_size_label === 'Standard' ? 'Standard (750 ml)' : r.bottle_size_label,
      r.bottle_size_ml,
      r.quantity,
      r.quantity_on_order || null,
      price,
      price == null ? null : r.currency,
      price == null ? null : Math.round(price * r.quantity * 100) / 100,
      best ? scoreCell(best.raw_value) : null,
      best ? scoreSource(best) : null,
      allScores || null,
      w.from == null ? null : String(w.from),
      w.to == null ? null : String(w.to),
      windowFrom,
      ready.state === 'unknown' ? null : ready.label,
      maturity ? MATURITY[maturity] : null,
      note?.rating == null ? null : Math.round((note.rating / 20) * 10) / 10,
      note?.tasted_on ? note.tasted_on.slice(0, 10) : null,
    ];
  });

  // Summary ------------------------------------------------------------------
  type Sum = {
    wines: Set<string>;
    bottles: number;
    magnums: number;
    other: number;
    onOrder: number;
    unpriced: number;
    value: Map<string, number>;
  };
  const empty = (): Sum => ({
    wines: new Set(),
    bottles: 0,
    magnums: 0,
    other: 0,
    onOrder: 0,
    unpriced: 0,
    value: new Map(),
  });
  const perCellar = new Map<string, Sum>(chosen.map((c) => [c.id, empty()]));
  const all = empty();
  for (const r of lots) {
    for (const s of [perCellar.get(r.cellar_id)!, all]) {
      s.wines.add(r.vintage_id);
      s.bottles += r.quantity;
      s.onOrder += r.quantity_on_order;
      if (r.bottle_size_ml === 1500) s.magnums += r.quantity;
      else if (r.bottle_size_ml !== 750) s.other += r.quantity;
      if (r.unit_price == null || !r.currency) s.unpriced += r.quantity;
      else
        s.value.set(r.currency, (s.value.get(r.currency) ?? 0) + Number(r.unit_price) * r.quantity);
    }
  }
  const money = (n: number) => Math.round(n * 100) / 100;
  const summaryRows: XlsxCell[][] = [];
  for (const c of chosen) {
    const s = perCellar.get(c.id)!;
    const currencies = s.value.size ? [...s.value.keys()] : [c.currency];
    currencies.forEach((cur, i) =>
      summaryRows.push(
        i === 0
          ? [
              c.name,
              s.wines.size,
              s.bottles,
              s.magnums,
              s.other,
              s.onOrder,
              money(s.value.get(cur) ?? 0),
              cur,
              s.unpriced,
            ]
          : [c.name, null, null, null, null, null, money(s.value.get(cur) ?? 0), cur, null],
      ),
    );
  }
  const footer: XlsxCell[][] = [];
  if (chosen.length > 1) {
    const currencies = [...all.value.keys()];
    if (currencies.length <= 1) {
      footer.push([
        'All cellars',
        all.wines.size,
        all.bottles,
        all.magnums,
        all.other,
        all.onOrder,
        money(all.value.get(currencies[0]) ?? 0),
        currencies[0] ?? null,
        all.unpriced,
      ]);
    } else {
      footer.push([
        'All cellars',
        all.wines.size,
        all.bottles,
        all.magnums,
        all.other,
        all.onOrder,
        null,
        null,
        all.unpriced,
      ]);
      for (const cur of currencies)
        footer.push([
          `Value in ${cur}`,
          null,
          null,
          null,
          null,
          null,
          money(all.value.get(cur)!),
          cur,
          null,
        ]);
    }
  }
  footer.push([
    `Exported ${today} from My Sommelier. Value = bottles in cellar × price paid; currencies are never added together.`,
  ]);

  const summary: XlsxSheet = {
    name: 'Summary',
    columns: [
      { header: 'Cellar', width: 16 },
      { header: 'Wines', width: 9, format: 'integer' },
      { header: 'Bottles (all sizes)', width: 18, format: 'integer' },
      { header: 'Magnums', width: 10, format: 'integer' },
      { header: 'Other sizes', width: 12, format: 'integer' },
      { header: 'On order', width: 10, format: 'integer' },
      { header: 'Value', width: 14, format: 'money' },
      { header: 'Currency', width: 10 },
      { header: 'Bottles without a price', width: 22, format: 'integer' },
    ],
    rows: summaryRows,
    footer,
  };

  const label = filter === ALL_CELLARS ? 'All cellars' : (chosen[0]?.name ?? 'Cellar');
  const safe = label.replace(/[\\/:*?"<>|]/g, ' ').trim();
  return {
    fileName: `My Sommelier - ${safe} - ${today}.xlsx`,
    sheets: [{ name: 'Bottles', columns: BOTTLE_COLUMNS, rows }, summary],
    bottles: all.bottles,
  };
}
