// Turns the raw sheets into an import plan: the exact rows the database will
// receive, plus a log of every change and every problem. The dry run is this
// plan written as a report; --apply inserts this plan unchanged.

import { randomUUID } from 'node:crypto';
import type { CellarSpec, RawRow, RawSheet, SheetLayout } from './workbook.ts';
import {
  SECTIONS,
  cleanText,
  isBlank,
  litresToMl,
  lookupPlace,
  parseAccolade,
  parseCount,
  parsePrice,
  parseScore,
  splitSizeFromName,
  titleCase,
  wineMatchKey,
  type ParsedScore,
} from './normalise.ts';

export interface PlanCellar extends CellarSpec {
  key: string; // sheet name
}

export interface PlanWine {
  id: string;
  key: string;
  name: string;
  source_name: string;
  country: string | null;
  region: string | null;
  appellation: string | null;
  /** Every raw spelling that matched this wine, with where it came from. */
  seen: { sheet: string; row: number; raw: string }[];
}

export interface PlanVintage {
  id: string;
  wine_id: string;
  year: number | null;
}

export interface PlanHolding {
  id: string;
  cellar: string; // sheet name
  vintage_id: string;
  wine_id: string;
  bottle_size_ml: number;
  unit_price: number | null;
  currency: string | null;
  notes: string | null;
  import_ref: Record<string, unknown>;
  // Counts from the sheet
  qty: number;
  gone: number;
  future: number;
  left_sheet: number;
  // What the ledger will produce
  in_cellar: number;
  on_order: number;
}

export interface PlanEvent {
  holding_id: string;
  event_type: 'imported' | 'consumed';
  quantity_delta: number;
  on_order_delta: number;
  note: string;
}

export interface PlanScore {
  vintage_id: string;
  score: ParsedScore;
}

export interface PlanAccolade {
  vintage_id: string;
  raw_text: string;
  publication: string | null;
  title: string | null;
  rank: number | null;
  year: number | null;
}

export type ChangeKind =
  | 'name_trimmed'
  | 'size_from_name'
  | 'size_conflict'
  | 'region_from_appellation'
  | 'region_unmapped'
  | 'appellation_conflict'
  | 'price_unknown'
  | 'price_formula'
  | 'total_typed'
  | 'score_unparsed'
  | 'score_range'
  | 'accolade_unparsed'
  | 'future_blank_text'
  | 'stray_cell'
  | 'wine_matched_across_names'
  | 'fully_drunk'
  | 'extras_kept';

export interface Change {
  sheet: string;
  row: number;
  kind: ChangeKind;
  detail: string;
}

export interface Problem {
  sheet: string;
  row: number;
  detail: string;
}

export interface SheetTotals {
  /** Bottles left according to the sheet's own summary rows. */
  left: number | null;
  inStorage: number | null;
  onItsWay: number | null;
  bought: number | null;
  gone: number | null;
}

export interface ImportPlan {
  cellars: PlanCellar[];
  wines: PlanWine[];
  vintages: PlanVintage[];
  holdings: PlanHolding[];
  events: PlanEvent[];
  scores: PlanScore[];
  accolades: PlanAccolade[];
  changes: Change[];
  problems: Problem[];
  skippedRows: { sheet: string; row: number; why: string }[];
  sheetTotals: Record<string, SheetTotals>;
  /** "raw spelling -> appellation / region": number of lines. */
  regionSpellings: Record<string, number>;
  /** Sheet lines that carried an accolade (before de-duplicating per vintage). */
  accoladeLines: number;
}

const v = (row: RawRow, col: string | undefined) => (col ? (row[col]?.value ?? null) : null);

function sectionOf(row: RawRow, layout: SheetLayout): string | null {
  // A section header has text in the wine column and nothing else that counts.
  const name = v(row, layout.cols.name);
  if (typeof name !== 'string' || !name.trim()) return null;
  if (!isBlank(v(row, layout.cols.year)) || !isBlank(v(row, layout.cols.qty))) return null;
  return cleanText(name).toUpperCase();
}

function readSheetTotals(sheet: RawSheet): SheetTotals {
  const { layout, summaryRows } = sheet;
  const t: SheetTotals = { left: null, inStorage: null, onItsWay: null, bought: null, gone: null };
  const num = (x: unknown) => (typeof x === 'number' ? x : null);
  for (const row of summaryRows.values()) {
    const labels = Object.values(row)
      .map((c) => (typeof c.value === 'string' ? c.value.trim().toLowerCase() : ''))
      .filter(Boolean);
    const label = labels.join(' ');
    if (
      label.includes('total wine') ||
      (t.left === null && !label && num(v(row, layout.cols.left)) !== null)
    ) {
      // "Total Wine" row (LA, Paris) or the unlabelled totals row (Oregon).
      t.left = num(v(row, layout.cols.left));
      t.bought = num(v(row, layout.cols.qty));
      t.gone = num(v(row, layout.cols.gone));
    } else if (label.startsWith('in storage')) {
      t.inStorage = firstNumber(row);
    } else if (label.startsWith("on it's way") || label.startsWith('on its way')) {
      t.onItsWay = firstNumber(row);
    }
  }
  return t;
}

function firstNumber(row: RawRow): number | null {
  for (const c of Object.values(row)) if (typeof c.value === 'number') return c.value;
  return null;
}

export function buildPlan(sheets: RawSheet[]): ImportPlan {
  const plan: ImportPlan = {
    cellars: [],
    wines: [],
    vintages: [],
    holdings: [],
    events: [],
    scores: [],
    accolades: [],
    changes: [],
    problems: [],
    skippedRows: [],
    sheetTotals: {},
    regionSpellings: {},
    accoladeLines: 0,
  };
  const winesByKey = new Map<string, PlanWine>();
  const vintagesByKey = new Map<string, PlanVintage>();
  const scoreKeys = new Set<string>();
  const accoladeKeys = new Set<string>();

  for (const sheet of sheets) {
    const { layout } = sheet;
    const s = layout.sheet;
    const cols = layout.cols;
    plan.cellars.push({ ...layout.cellar, key: s });
    plan.sheetTotals[s] = readSheetTotals(sheet);

    let section = layout.defaultSection ?? null;
    const change = (row: number, kind: ChangeKind, detail: string) =>
      plan.changes.push({ sheet: s, row, kind, detail });
    const problem = (row: number, detail: string) => plan.problems.push({ sheet: s, row, detail });

    for (const [r, row] of sheet.rows) {
      const yearV = v(row, cols.year);
      const nameV = v(row, cols.name);

      if (!(typeof yearV === 'number' && typeof nameV === 'string' && nameV.trim())) {
        const header = sectionOf(row, layout);
        if (header) {
          if (!SECTIONS[header]) problem(r, `Unknown section header "${header}"`);
          else section = header;
          plan.skippedRows.push({ sheet: s, row: r, why: `section header ${header}` });
          continue;
        }
        const filled = Object.entries(row).filter(([, c]) => !isBlank(c.value));
        if (filled.length === 0) {
          if (Object.keys(row).length) {
            change(r, 'stray_cell', `Blank-looking cells ignored: ${Object.keys(row).join(', ')}`);
          }
          continue;
        }
        problem(
          r,
          `Row has data but no vintage and wine name: ${filled.map(([k, c]) => `${k}=${c.value}`).join(', ')}`,
        );
        continue;
      }

      if (!Number.isInteger(yearV) || yearV < 1800 || yearV > 2200) {
        problem(r, `Vintage "${yearV}" is not a year`);
        continue;
      }
      const sec = section ? SECTIONS[section] : undefined;
      if (!sec) {
        problem(r, 'No country section above this line');
        continue;
      }

      // Name and bottle size
      const rawName = nameV;
      let name = cleanText(rawName);
      if (name !== rawName) change(r, 'name_trimmed', `"${rawName}" -> "${name}"`);
      const split = splitSizeFromName(name);
      name = split.name;
      let sizeMl = 750;
      const sizeCol = litresToMl(v(row, cols.size));
      if (cols.size && sizeCol === null && !isBlank(v(row, cols.size))) {
        problem(r, `Bottle size "${v(row, cols.size)}" is not a number of litres`);
      }
      if (split.sizeMl) {
        sizeMl = split.sizeMl;
        change(r, 'size_from_name', `"1.5L" in the name -> magnum (1500 ml)`);
      }
      if (sizeCol) {
        if (split.sizeMl && split.sizeMl !== sizeCol) {
          change(
            r,
            'size_conflict',
            `Name says ${split.sizeMl} ml, size column says ${sizeCol} ml; using the size column`,
          );
        }
        sizeMl = sizeCol;
      }

      // Region
      const rawRegion = v(row, cols.region);
      let appellation: string | null = null;
      let region: string | null = sec.region ?? null;
      if (!isBlank(rawRegion)) {
        const place = lookupPlace(String(rawRegion));
        if (place) {
          appellation = place.appellation;
          if (place.region) {
            if (sec.region && place.region !== sec.region) {
              change(
                r,
                'region_from_appellation',
                `${rawRegion} is in ${place.region}, though listed under ${section}`,
              );
            }
            region = place.region;
          }
          const key = `${String(rawRegion).trim()} -> ${place.appellation ?? '(none)'} / ${place.region ?? '(none)'}`;
          plan.regionSpellings[key] = (plan.regionSpellings[key] ?? 0) + 1;
        } else {
          appellation = titleCase(String(rawRegion));
          change(
            r,
            'region_unmapped',
            `"${rawRegion}" not in the region list; kept as "${appellation}"`,
          );
        }
      }

      // Wine and vintage
      const key = wineMatchKey(name, sec.country);
      let wine = winesByKey.get(key);
      if (!wine) {
        wine = {
          id: randomUUID(),
          key,
          name: titleCase(name),
          source_name: rawName.trim(),
          country: sec.country,
          region,
          appellation,
          seen: [],
        };
        winesByKey.set(key, wine);
        plan.wines.push(wine);
      } else {
        const first = wine.seen[0];
        if (
          first &&
          cleanText(splitSizeFromName(first.raw).name).toUpperCase() !== name.toUpperCase()
        ) {
          change(
            r,
            'wine_matched_across_names',
            `"${name}" matched "${first.raw.trim()}" (${first.sheet} row ${first.row})`,
          );
        }
        if (appellation && wine.appellation && appellation !== wine.appellation) {
          const was = wine.appellation;
          if (layout.regionWins) {
            wine.appellation = appellation;
            if (region) wine.region = region;
          }
          const kept = layout.regionWins ? appellation : was;
          change(
            r,
            'appellation_conflict',
            `"${rawRegion}" here, but ${was} on ${first?.sheet} row ${first?.row}; the wine uses ${kept}${layout.regionWins ? ` (the ${s} sheet's region wins)` : ''}`,
          );
        }
        if (!wine.appellation && appellation) wine.appellation = appellation;
        if (!wine.region && region) wine.region = region;
      }
      wine.seen.push({ sheet: s, row: r, raw: rawName });

      const vKey = `${wine.id}|${yearV}`;
      let vintage = vintagesByKey.get(vKey);
      if (!vintage) {
        vintage = { id: randomUUID(), wine_id: wine.id, year: yearV };
        vintagesByKey.set(vKey, vintage);
        plan.vintages.push(vintage);
      }

      // Counts
      const qty = parseCount(v(row, cols.qty));
      const gone = parseCount(v(row, cols.gone));
      const future = parseCount(v(row, cols.future));
      const left = parseCount(v(row, cols.left));
      for (const [label, c, col] of [
        ['QTY', qty, cols.qty],
        ['GONE', gone, cols.gone],
        ['FUTURE', future, cols.future],
        ['LEFT', left, cols.left],
      ] as const) {
        if (!c.ok) problem(r, `${label} "${v(row, col)}" is not a whole number of bottles`);
      }
      const rawFuture = v(row, cols.future);
      if (typeof rawFuture === 'string' && !rawFuture.trim()) {
        change(r, 'future_blank_text', 'FUTURE holds a space; read as 0');
      }
      if (qty.value - gone.value !== left.value) {
        problem(r, `LEFT ${left.value} is not QTY ${qty.value} − GONE ${gone.value}`);
      }
      const inCellar = qty.value - future.value - gone.value;
      if (inCellar < 0) {
        problem(
          r,
          `More bottles gone (${gone.value}) than delivered (${qty.value - future.value})`,
        );
      }
      if (qty.value === 0) problem(r, 'QTY is 0');
      if (left.value === 0)
        change(r, 'fully_drunk', 'No bottles left; imported as history with 0 in the cellar');

      // Price
      const priceCell = cols.price ? row[cols.price] : undefined;
      const price = parsePrice(priceCell?.value ?? null);
      if (price === null) {
        change(
          r,
          'price_unknown',
          isBlank(priceCell?.value)
            ? 'No price; stored as unknown'
            : `Price ${priceCell?.value}; stored as unknown`,
        );
      }
      if (priceCell?.formula)
        change(r, 'price_formula', `Price =${priceCell.formula} evaluated to ${priceCell.value}`);

      let notes: string | null = null;
      const totalCell = row[cols.total];
      const typedTotal =
        totalCell && !totalCell.formula && typeof totalCell.value === 'number'
          ? totalCell.value
          : null;
      if (typedTotal !== null && price !== null) {
        const expected = Math.round(price * qty.value * 100) / 100;
        // Prices derived as TOTAL / QTY round to cents, so allow one unit.
        if (Math.abs(expected - typedTotal) >= 1) {
          notes = `Spreadsheet TOTAL was typed as ${typedTotal} (price × QTY = ${expected}).`;
          change(r, 'total_typed', notes);
        }
      }

      // import_ref keeps the raw cells for reconciliation and audit
      const raw: Record<string, unknown> = {};
      for (const [field, col] of Object.entries(cols)) {
        if (typeof col !== 'string') continue;
        const c = row[col];
        if (c && !isBlank(c.value))
          raw[field] = c.formula ? { value: c.value, formula: c.formula } : c.value;
      }
      const importRef: Record<string, unknown> = { sheet: s, row: r, section, raw };
      if (cols.extras) {
        const extras: Record<string, unknown> = {};
        for (const col of cols.extras)
          if (row[col] && !isBlank(row[col].value)) extras[col] = row[col].value;
        if (Object.keys(extras).length) {
          importRef.extras = extras;
          change(r, 'extras_kept', `Hidden columns kept in import_ref: ${JSON.stringify(extras)}`);
        }
      }
      if (cols.marker && !isBlank(v(row, cols.marker))) {
        importRef.marker = v(row, cols.marker);
        if (!importRef.extras)
          change(r, 'extras_kept', `Marker "${v(row, cols.marker)}" kept in import_ref`);
      }

      const holding: PlanHolding = {
        id: randomUUID(),
        cellar: s,
        vintage_id: vintage.id,
        wine_id: wine.id,
        bottle_size_ml: sizeMl,
        unit_price: price,
        currency: price === null ? null : layout.cellar.currency,
        notes,
        import_ref: importRef,
        qty: qty.value,
        gone: gone.value,
        future: future.value,
        left_sheet: left.value,
        in_cellar: inCellar,
        on_order: future.value,
      };
      plan.holdings.push(holding);

      if (qty.value - future.value > 0 || future.value > 0) {
        plan.events.push({
          holding_id: holding.id,
          event_type: 'imported',
          quantity_delta: qty.value - future.value,
          on_order_delta: future.value,
          note: `Opening balance from ${s} row ${r} (QTY ${qty.value}${future.value ? `, ${future.value} on order` : ''})`,
        });
      }
      if (gone.value > 0) {
        plan.events.push({
          holding_id: holding.id,
          event_type: 'consumed',
          quantity_delta: -gone.value,
          on_order_delta: 0,
          note: `GONE column on ${s} row ${r}; dates unknown`,
        });
      }

      // Score (one per vintage and raw value)
      const score = parseScore(v(row, cols.score));
      if (score) {
        if (!score.parsed) change(r, 'score_unparsed', `Score "${score.raw}" kept as text only`);
        if (score.barrel)
          change(
            r,
            'score_range',
            `Score "${score.raw}" -> ${score.low} to ${score.high}, pre-release`,
          );
        const sk = `${vintage.id}|${score.raw}`;
        if (!scoreKeys.has(sk)) {
          scoreKeys.add(sk);
          plan.scores.push({ vintage_id: vintage.id, score });
        }
      }

      const acc = parseAccolade(v(row, cols.accolade));
      if (acc) {
        plan.accoladeLines++;
        if (!acc.publication)
          change(r, 'accolade_unparsed', `Accolade "${acc.raw}" kept as text only`);
        const ak = `${vintage.id}|${acc.raw}`;
        if (!accoladeKeys.has(ak)) {
          accoladeKeys.add(ak);
          plan.accolades.push({
            vintage_id: vintage.id,
            raw_text: acc.raw,
            publication: acc.publication,
            title: acc.title,
            rank: acc.rank,
            year: acc.year,
          });
        }
      }
    }

    // Nothing that looks like a wine line may hide in the summary block.
    for (const [r, row] of sheet.summaryRows) {
      const y = v(row, cols.year);
      const n = v(row, cols.name);
      if (typeof y === 'number' && typeof n === 'string' && n.trim()) {
        problem(r, `Looks like a wine line below the data range: ${y} ${n}`);
      }
    }
  }

  return plan;
}

export interface CellarCounts {
  cellar: string;
  sheet: string;
  lines: number;
  wines: number;
  bought: number;
  gone: number;
  leftSheet: number;
  inCellar: number;
  onOrder: number;
  physical: number;
  magnums: number;
  otherSizes: number;
  pricedBottles: number;
  unpricedBottles: number;
  costOfBottlesLeft: number;
  currency: string;
}

export function countsByCellar(plan: ImportPlan): CellarCounts[] {
  return plan.cellars.map((c) => {
    const hs = plan.holdings.filter((h) => h.cellar === c.key);
    const sum = (f: (h: PlanHolding) => number) => hs.reduce((a, h) => a + f(h), 0);
    return {
      cellar: c.name,
      sheet: c.key,
      lines: hs.length,
      wines: new Set(hs.map((h) => h.wine_id)).size,
      bought: sum((h) => h.qty),
      gone: sum((h) => h.gone),
      leftSheet: sum((h) => h.left_sheet),
      inCellar: sum((h) => h.in_cellar),
      onOrder: sum((h) => h.on_order),
      physical: sum((h) => h.in_cellar + h.on_order),
      magnums: sum((h) => (h.bottle_size_ml === 1500 ? h.in_cellar + h.on_order : 0)),
      otherSizes: sum((h) =>
        h.bottle_size_ml !== 1500 && h.bottle_size_ml !== 750 ? h.in_cellar + h.on_order : 0,
      ),
      pricedBottles: sum((h) => (h.unit_price !== null ? h.left_sheet : 0)),
      unpricedBottles: sum((h) => (h.unit_price === null ? h.left_sheet : 0)),
      costOfBottlesLeft: Math.round(sum((h) => (h.unit_price ?? 0) * h.left_sheet) * 100) / 100,
      currency: c.currency,
    };
  });
}
