import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook } from '../src/workbook.ts';
import { buildPlan, countsByCellar } from '../src/plan.ts';
import { reconcile, renderMarkdown, spotCheck } from '../src/report.ts';
import { FIXTURE_EXPECT, buildFixture, fixtureLayouts } from './fixture.ts';

const plan = buildPlan(await readWorkbook(await buildFixture(), await fixtureLayouts()));
const counts = Object.fromEntries(countsByCellar(plan).map((c) => [c.sheet, c]));
const holding = (sheet: string, row: number) =>
  plan.holdings.find((h) => h.cellar === sheet && h.import_ref.row === row)!;
const wineOf = (sheet: string, row: number) =>
  plan.wines.find((w) => w.id === holding(sheet, row).wine_id)!;
const kinds = (sheet: string, row: number) =>
  plan.changes.filter((c) => c.sheet === sheet && c.row === row).map((c) => c.kind);

test('maps every line and nothing else', () => {
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.holdings.length, 13);
  for (const [sheet, n] of Object.entries(FIXTURE_EXPECT.lines))
    assert.equal(counts[sheet].lines, n, sheet);
});

test('reconciles with the expected counts and the sheet totals', () => {
  const checks = reconcile(plan, FIXTURE_EXPECT);
  assert.deepEqual(
    checks.filter((c) => !c.ok),
    [],
  );
  assert.equal(counts.NCP.inCellar, 12);
  assert.equal(counts.NCP.onOrder, 4);
  assert.equal(counts.Paris.magnums, 7);
});

test('a wrong expectation fails the reconciliation', () => {
  const checks = reconcile(plan, {
    ...FIXTURE_EXPECT,
    physical: { ...FIXTURE_EXPECT.physical, NCP: 17 },
  });
  assert.equal(checks.filter((c) => !c.ok).length, 2); // the cellar and the all-cellars total
});

test('carries section headers down as country and US state', () => {
  assert.equal(wineOf('NCP', 3).country, 'France');
  assert.equal(wineOf('NCP', 7).region, 'California');
  assert.equal(wineOf('O', 2).region, 'Oregon');
  assert.equal(wineOf('Paris', 6).country, 'Spain');
});

test('Walla Walla on the Oregon sheet is Washington', () => {
  assert.equal(wineOf('O', 3).region, 'Washington');
  assert.ok(kinds('O', 3).includes('region_from_appellation'));
});

test('on-order bottles are split from bottles in the cellar', () => {
  const truss = holding('NCP', 8);
  assert.equal(truss.in_cellar, 0);
  assert.equal(truss.on_order, 4);
  const ev = plan.events.filter((e) => e.holding_id === truss.id);
  assert.deepEqual(
    ev.map((e) => [e.event_type, e.quantity_delta, e.on_order_delta]),
    [['imported', 0, 4]],
  );
});

test('GONE becomes a consumed event after the opening balance', () => {
  const h = holding('NCP', 3);
  const ev = plan.events.filter((e) => e.holding_id === h.id);
  assert.deepEqual(
    ev.map((e) => [e.event_type, e.quantity_delta]),
    [
      ['imported', 4],
      ['consumed', -1],
    ],
  );
});

test('fully drunk lines are kept as history', () => {
  const h = holding('NCP', 5);
  assert.equal(h.in_cellar, 0);
  assert.ok(kinds('NCP', 5).includes('fully_drunk'));
});

test('bottle size comes from the name or the Paris size column', () => {
  assert.equal(holding('NCP', 7).bottle_size_ml, 1500);
  assert.equal(wineOf('NCP', 7).name, 'Saxum Bone Rock');
  assert.equal(holding('Paris', 3).bottle_size_ml, 1500);
  assert.equal(holding('Paris', 4).bottle_size_ml, 750);
  assert.equal(holding('Paris', 7).bottle_size_ml, 1500);
});

test('the same wine across cellars is one wine with one vintage', () => {
  assert.equal(wineOf('NCP', 4).id, wineOf('Paris', 3).id); // BARDE-HAUT / CHATEAU BARDE-HAUT
  assert.equal(holding('NCP', 4).vintage_id, holding('Paris', 3).vintage_id);
  assert.equal(wineOf('NCP', 11).id, wineOf('O', 2).id); // Bergstrom Sigrid in LA and Oregon
  assert.equal(holding('NCP', 11).vintage_id, holding('O', 2).vintage_id);
  // Same vintage and same score on two lines: one score row.
  assert.equal(plan.scores.filter((s) => s.vintage_id === holding('O', 2).vintage_id).length, 1);
});

test('prices: currency by cellar, 0 and blank unknown, formulas evaluated', () => {
  assert.equal(holding('NCP', 3).currency, 'USD');
  assert.equal(holding('Paris', 3).currency, 'EUR');
  assert.equal(holding('NCP', 4).unit_price, null);
  assert.equal(holding('Paris', 4).unit_price, null);
  assert.equal(holding('NCP', 5).unit_price, 68);
  assert.ok(kinds('NCP', 5).includes('price_formula'));
});

test('a typed TOTAL that disagrees is kept as a note', () => {
  assert.match(holding('O', 4).notes ?? '', /typed as 999/);
});

test('scores keep their text; ranges are pre-release', () => {
  const s = plan.scores.find((x) => x.score.raw === '92-94')!;
  assert.deepEqual([s.score.low, s.score.high, s.score.barrel], [92, 94, true]);
  assert.ok(plan.scores.some((x) => x.score.raw === '94+' && x.score.plus));
});

test('accolades are parsed', () => {
  assert.equal(plan.accolades.length, 2);
  assert.ok(
    plan.accolades.some(
      (a) => a.publication === 'Wine Spectator' && a.rank === 1 && a.year === 2019,
    ),
  );
});

test('hidden Paris cells are kept in import_ref', () => {
  const h = holding('Paris', 6);
  assert.deepEqual(h.import_ref.extras, { O: 140, P: 420, R: 70 });
  assert.equal(h.import_ref.marker, '*');
});

test('the report renders and the spot check spans every cellar', () => {
  const md = renderMarkdown(
    plan,
    { workbook: 'fixture.xlsx', sha256: '0'.repeat(64), generatedAt: 'now', mode: 'dry-run' },
    reconcile(plan, FIXTURE_EXPECT),
  );
  assert.match(md, /every count matches/);
  assert.match(md, /Nothing was written/);
  const picked = spotCheck(plan);
  assert.equal(picked.length, 13); // fewer lines than 20, so all of them
  assert.deepEqual(new Set(picked.map((h) => h.cellar)), new Set(['NCP', 'O', 'Paris']));
});
