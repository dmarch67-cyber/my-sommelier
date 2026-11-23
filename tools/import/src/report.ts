// The reconciliation report: the same plan --apply would insert, written out
// for a person to check. Markdown for reading, JSON for tools.

import {
  countsByCellar,
  type Change,
  type ChangeKind,
  type ImportPlan,
  type PlanHolding,
} from './plan.ts';

export interface Expectations {
  /** Physical bottles (in cellar + on order) per sheet. */
  physical: Record<string, number>;
  inCellar?: Record<string, number>;
  onOrder?: Record<string, number>;
  magnums?: Record<string, number>;
  lines?: Record<string, number>;
}

export interface CheckRow {
  check: string;
  expected: number | null;
  sheetSays: number | null;
  plan: number;
  ok: boolean;
}

export interface ReportMeta {
  workbook: string;
  sha256: string;
  generatedAt: string;
  mode: 'dry-run' | 'apply' | 'rehearsal';
}

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '–' : n.toLocaleString('en-US');

export function reconcile(plan: ImportPlan, expect?: Expectations): CheckRow[] {
  const counts = countsByCellar(plan);
  const rows: CheckRow[] = [];
  const add = (
    check: string,
    expected: number | null | undefined,
    sheetSays: number | null | undefined,
    value: number,
  ) => {
    const e = expected ?? null;
    const s = sheetSays ?? null;
    rows.push({
      check,
      expected: e,
      sheetSays: s,
      plan: value,
      ok: (e === null || e === value) && (s === null || s === value),
    });
  };
  for (const c of counts) {
    const t = plan.sheetTotals[c.sheet];
    add(`${c.cellar}: lines`, expect?.lines?.[c.sheet], null, c.lines);
    add(
      `${c.cellar}: physical bottles (in cellar + on order)`,
      expect?.physical[c.sheet],
      t?.left,
      c.physical,
    );
    add(`${c.cellar}: in the cellar`, expect?.inCellar?.[c.sheet], t?.inStorage, c.inCellar);
    add(`${c.cellar}: on order`, expect?.onOrder?.[c.sheet], t?.onItsWay, c.onOrder);
    add(`${c.cellar}: magnums`, expect?.magnums?.[c.sheet], null, c.magnums);
    add(`${c.cellar}: bottles bought (QTY)`, null, t?.bought, c.bought);
    add(`${c.cellar}: bottles gone`, null, t?.gone, c.gone);
  }
  const total = (f: (c: (typeof counts)[number]) => number) => counts.reduce((a, c) => a + f(c), 0);
  const sumExp = (m?: Record<string, number>) =>
    m ? Object.values(m).reduce((a, b) => a + b, 0) : null;
  add(
    'All cellars: physical bottles',
    sumExp(expect?.physical),
    null,
    total((c) => c.physical),
  );
  add(
    'All cellars: magnums',
    sumExp(expect?.magnums),
    null,
    total((c) => c.magnums),
  );
  add(
    'All cellars: on order',
    sumExp(expect?.onOrder),
    null,
    total((c) => c.onOrder),
  );
  return rows;
}

const KIND_TITLES: Record<ChangeKind, string> = {
  name_trimmed: 'Extra spaces removed from wine names',
  size_from_name: '"1.5L" taken out of the name and stored as a magnum',
  size_conflict: 'Name and size column disagree',
  region_from_appellation: 'Region taken from the appellation, not the sheet',
  region_unmapped: 'Region not in the region list',
  appellation_conflict: 'Same wine listed with a different region on another line',
  price_unknown: 'Price blank or 0, stored as unknown',
  price_formula: 'Price was a formula; its result is used',
  total_typed: 'TOTAL typed over the formula and different from price × QTY (kept as a note)',
  score_unparsed: 'Score kept as text only',
  score_range: 'Score range stored as low and high, pre-release',
  accolade_unparsed: 'Accolade kept as text only',
  future_blank_text: 'FUTURE cell holds a space, read as 0',
  stray_cell: 'Blank-looking rows ignored',
  wine_matched_across_names: 'Same wine recognised under a different spelling',
  fully_drunk: 'No bottles left; imported as history',
  extras_kept: 'Extra cells kept in import_ref',
};

function sheetName(plan: ImportPlan, sheet: string) {
  return plan.cellars.find((c) => c.key === sheet)?.name ?? sheet;
}

/**
 * Twenty holdings for a spot check: spread across the cellars and chosen to
 * cover the awkward cases (magnums, on order, ranges, matched names, no price).
 */
export function spotCheck(plan: ImportPlan, n = 20): PlanHolding[] {
  const picked = new Map<string, PlanHolding>();
  const take = (h: PlanHolding | undefined) => h && picked.size < n && picked.set(h.id, h);
  const byRow = (sheet: string, row: number) =>
    plan.holdings.find((h) => h.cellar === sheet && h.import_ref.row === row);
  const rowsOf = (kind: ChangeKind) => plan.changes.filter((c) => c.kind === kind);
  const first = (kind: ChangeKind, sheet?: string) => {
    const c = rowsOf(kind).find((x) => !sheet || x.sheet === sheet);
    return c ? byRow(c.sheet, c.row) : undefined;
  };
  take(plan.holdings.find((h) => h.on_order > 0));
  take(first('size_from_name', 'NCP'));
  take(plan.holdings.find((h) => h.cellar === 'Paris' && h.bottle_size_ml === 1500));
  take(first('score_range'));
  take(first('wine_matched_across_names', 'Paris'));
  take(first('wine_matched_across_names', 'O'));
  take(first('price_unknown', 'Paris'));
  take(first('price_unknown', 'NCP'));
  take(first('fully_drunk'));
  take(first('total_typed', 'O'));
  take(first('region_from_appellation'));
  take(first('extras_kept'));
  take(first('price_formula'));
  // Fill the rest evenly from each sheet, every k-th line.
  const sheets = plan.cellars.map((c) => c.key);
  let round = 0;
  while (picked.size < Math.min(n, plan.holdings.length) && round < 50) {
    for (const s of sheets) {
      const hs = plan.holdings.filter((h) => h.cellar === s);
      if (!hs.length) continue;
      const step = Math.max(1, Math.floor(hs.length / 4));
      take(hs[(round * step + Math.floor(step / 2)) % hs.length]);
    }
    round++;
  }
  return [...picked.values()];
}

function holdingLine(plan: ImportPlan, h: PlanHolding) {
  const wine = plan.wines.find((w) => w.id === h.wine_id)!;
  const vintage = plan.vintages.find((v) => v.id === h.vintage_id)!;
  const raw = h.import_ref.raw as Record<string, unknown>;
  const score = raw.score === undefined ? null : String(raw.score);
  const price = h.unit_price === null ? 'unknown' : `${h.unit_price} ${h.currency}`;
  const size = h.bottle_size_ml === 750 ? '750 ml' : `${h.bottle_size_ml} ml`;
  return `| ${sheetName(plan, h.cellar)} ${h.import_ref.row} | ${vintage.year ?? 'NV'} ${String(raw.name ?? '').trim()} | ${wine.name} | ${[wine.appellation, wine.region, wine.country].filter(Boolean).join(', ')} | ${size} | ${h.in_cellar}${h.on_order ? ` + ${h.on_order} on order` : ''} | ${h.gone} | ${price} | ${score ?? '–'} |`;
}

export function renderMarkdown(plan: ImportPlan, meta: ReportMeta, checks: CheckRow[]): string {
  const counts = countsByCellar(plan);
  const allOk = checks.every((c) => c.ok) && plan.problems.length === 0;
  const out: string[] = [];
  const title =
    meta.mode === 'dry-run'
      ? 'Import dry run'
      : meta.mode === 'rehearsal'
        ? 'Import rehearsal'
        : 'Import run';
  out.push(`# ${title}: ${meta.workbook}`, '');
  out.push(`Generated ${meta.generatedAt}. Workbook SHA-256 \`${meta.sha256.slice(0, 16)}…\`.`, '');
  if (meta.mode === 'dry-run')
    out.push('**Nothing was written.** This dry run did not connect to any database.', '');
  out.push(
    allOk
      ? '**Result: every count matches.** No line was left unmapped.'
      : `**Result: ${checks.filter((c) => !c.ok).length} count(s) differ and ${plan.problems.length} line(s) could not be mapped.** See below.`,
    '',
  );

  out.push('## Reconciliation', '');
  out.push(
    '"Expected" is the Data Steward audit (Checkpoint B). "Sheet says" is the workbook\'s own total rows. Physical bottles count a magnum as one bottle.',
    '',
  );
  out.push('| Check | Expected | Sheet says | Importer | |', '|---|--:|--:|--:|:-:|');
  for (const c of checks)
    out.push(
      `| ${c.check} | ${fmt(c.expected)} | ${fmt(c.sheetSays)} | ${fmt(c.plan)} | ${c.ok ? '✓' : '✗'} |`,
    );
  out.push('');

  out.push('## Per cellar', '');
  out.push(
    '| Cellar | Lines | Wines | Bought | Gone | In cellar | On order | Magnums | Priced bottles | Unpriced | Cost of bottles left |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  );
  for (const c of counts) {
    out.push(
      `| ${c.cellar === c.sheet ? c.cellar : `${c.cellar} (sheet ${c.sheet})`} | ${fmt(c.lines)} | ${fmt(c.wines)} | ${fmt(c.bought)} | ${fmt(c.gone)} | ${fmt(c.inCellar)} | ${fmt(c.onOrder)} | ${fmt(c.magnums)} | ${fmt(c.pricedBottles)} | ${fmt(c.unpricedBottles)} | ${c.currency} ${fmt(Math.round(c.costOfBottlesLeft))} |`,
    );
  }
  out.push('');

  const imported = plan.events.filter((e) => e.event_type === 'imported').length;
  const consumed = plan.events.filter((e) => e.event_type === 'consumed').length;
  const ranges = plan.scores.filter((s) => s.score.barrel).length;
  const plus = plan.scores.filter((s) => s.score.plus).length;
  const multiCellar = plan.wines.filter((w) => new Set(w.seen.map((s) => s.sheet)).size > 1);
  out.push('## What the import will create', '');
  out.push(
    `- ${plan.cellars.length} cellars: ${plan.cellars.map((c) => `${c.name} (${c.currency})`).join(', ')}`,
  );
  out.push(
    `- ${fmt(plan.wines.length)} wines and ${fmt(plan.vintages.length)} vintages. ${multiCellar.length} wines are in more than one cellar.`,
  );
  out.push(`- ${fmt(plan.holdings.length)} holdings, one per sheet line.`);
  out.push(
    `- ${fmt(plan.events.length)} inventory events: ${fmt(imported)} opening balances (\`imported\`) and ${fmt(consumed)} \`consumed\` for the GONE column, with no dates.`,
  );
  out.push(
    `- ${fmt(plan.scores.length)} scores, source "unknown" (the RP column). A vintage on several lines with the same score gets one score row. Of these, ${plus} have a plus and ${ranges} are barrel ranges.`,
  );
  out.push(
    `- ${plan.accolades.length} accolades from ${plan.accoladeLines} sheet lines (the same accolade on two lines of one vintage is stored once).`,
  );
  out.push('');

  out.push('## Every change the importer makes', '');
  const byKind = new Map<ChangeKind, Change[]>();
  for (const c of plan.changes) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  for (const [kind, list] of byKind) {
    out.push(`### ${KIND_TITLES[kind]} (${list.length})`, '');
    for (const c of list) out.push(`- ${sheetName(plan, c.sheet)} row ${c.row}: ${c.detail}`);
    out.push('');
  }

  out.push('### Region spellings', '');
  out.push('| As written | Lines | Stored as appellation / region |', '|---|--:|---|');
  for (const [k, n] of Object.entries(plan.regionSpellings).sort()) {
    const [raw, to] = k.split(' -> ');
    out.push(`| ${raw} | ${n} | ${to} |`);
  }
  out.push('');

  out.push('### Wines in more than one cellar', '');
  for (const w of multiCellar) {
    const where = [...new Set(w.seen.map((s) => sheetName(plan, s.sheet)))].join(', ');
    out.push(`- ${w.name}: ${where}`);
  }
  out.push('');

  out.push('## Lines that could not be mapped', '');
  if (!plan.problems.length) out.push('None.', '');
  else {
    for (const p of plan.problems)
      out.push(`- ${sheetName(plan, p.sheet)} row ${p.row}: ${p.detail}`);
    out.push('');
  }

  out.push('## Spot check: 20 lines', '');
  out.push(
    'Check these against the spreadsheet. "Bottles" is what the app will show in the cellar.',
    '',
  );
  out.push(
    '| Sheet row | As written | Wine name in the app | Place | Size | Bottles | Gone | Price | Score |',
    '|---|---|---|---|---|--:|--:|--:|---|',
  );
  for (const h of spotCheck(plan)) out.push(holdingLine(plan, h));
  out.push('');

  out.push('## Not imported', '');
  out.push('- Section headers, blank rows and the summary blocks (used above only to reconcile).');
  out.push(
    '- LEFT and TOTAL: both are derived (LEFT = in cellar + on order; TOTAL = price × QTY). Typed-over TOTALs that disagree are kept as a note on the holding.',
  );
  out.push(
    '- Paris column S (litres left) and the O1 date. Row 56\'s hidden market-value cells and "*" are kept in that holding\'s import_ref.',
  );
  out.push(
    '- Producer and cuvée are not split yet; enrichment will fill `producer` when it matches CellarTracker or Vinous. The raw name is kept in `source_name`.',
  );
  out.push('');
  return out.join('\n');
}

export function renderJson(plan: ImportPlan, meta: ReportMeta, checks: CheckRow[]) {
  return JSON.stringify({ meta, checks, counts: countsByCellar(plan), plan }, null, 2);
}
