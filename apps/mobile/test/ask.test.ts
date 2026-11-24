import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanAnswer,
  cleanRows,
  findWines,
  runTool,
  type AskRow,
} from '../../../supabase/functions/ask-cellar/cellar.ts';
import { buildAskRows, looksLikeQuestion, maturityProgress } from '../src/logic/ask.ts';
import type { InventoryRow, Maturity, TastingNote } from '../src/logic/cellar.ts';

const YEAR = 2026;
let n = 0;
function line(over: Partial<InventoryRow>): InventoryRow {
  n += 1;
  return {
    holding_id: `h${n}`,
    account_id: 'a1',
    cellar_id: 'paris',
    cellar_name: 'Paris',
    wine_id: `w${n}`,
    wine_name: `Wine ${n}`,
    producer: null,
    country: 'France',
    region: 'Bordeaux',
    appellation: 'Pauillac',
    sub_region: 'Médoc',
    colour: 'red',
    vintage_id: `v${n}`,
    vintage: 2010,
    drink_from: 2018,
    drink_to: 2040,
    bottle_size_ml: 750,
    bottle_size_label: '750ml',
    is_non_standard_size: false,
    quantity: 6,
    quantity_on_order: 0,
    unit_price: 100,
    currency: 'EUR',
    body: 'full',
    grapes: ['Cabernet Sauvignon', 'Merlot'],
    ...over,
  };
}

function rowsFrom(inventory: InventoryRow[], maturity = new Map<string, Maturity>()) {
  return buildAskRows({
    inventory,
    scores: [],
    notes: [],
    maturity,
    critics: new Map(),
    year: YEAR,
  });
}

test('questions are told apart from wine names', () => {
  assert.equal(looksLikeQuestion('which are my most mature wines', 0), true);
  assert.equal(looksLikeQuestion('How many Bordeaux in Paris', 5), true);
  assert.equal(looksLikeQuestion('lynch bages?', 3), true);
  assert.equal(looksLikeQuestion('lynch bages', 3), false);
  assert.equal(looksLikeQuestion('bordeaux', 40), false);
  assert.equal(looksLikeQuestion('pinot that goes with salmon', 0), true);
  assert.equal(looksLikeQuestion('   ', 0), false);
  assert.equal(looksLikeQuestion("What's ready to drink", 0), true);
});

test('maturity runs from 0 at the window start to 1 at its end, and above when past', () => {
  assert.equal(maturityProgress(2016, 2026, YEAR, null), 1);
  assert.equal(maturityProgress(2026, 2036, YEAR, null), 0);
  assert.ok(maturityProgress(2000, 2020, YEAR, null)! > 1);
  assert.equal(maturityProgress(null, null, YEAR, null), null);
  assert.equal(maturityProgress(null, null, YEAR, 'past_it'), 1.3);
  assert.ok(maturityProgress(2030, 2040, YEAR, 'too_young')! < 0);
});

test('rows are per wine per cellar, with magnums and what was paid', () => {
  const v = line({ vintage_id: 'vx', wine_id: 'wx', cellar_id: 'la', cellar_name: 'LA' });
  const rows = rowsFrom([
    v,
    { ...v, holding_id: 'h-mag', bottle_size_ml: 1500, quantity: 2, unit_price: 300 },
    { ...v, holding_id: 'h-par', cellar_id: 'paris', cellar_name: 'Paris', quantity: 3 },
    line({ quantity: 0, quantity_on_order: 0 }),
  ]);
  assert.equal(rows.length, 2);
  const la = rows.find((r) => r.cellar === 'LA')!;
  assert.equal(la.bottles, 8);
  assert.equal(la.magnums, 2);
  assert.equal(la.cost, 6 * 100 + 2 * 300);
  assert.equal(la.price, 150);
  assert.equal(la.priced_bottles, 8);
  assert.equal(rows.find((r) => r.cellar === 'Paris')!.bottles, 3);
});

test('the owner’s notes travel with the row, newest first', () => {
  const v = line({ vintage_id: 'vn' });
  const note = (d: string, text: string): TastingNote => ({
    id: d,
    account_id: 'a1',
    vintage_id: 'vn',
    inventory_event_id: null,
    tasted_on: d,
    rating: 92,
    maturity: null,
    notes: text,
    food_pairing: null,
    occasion: null,
    would_buy_again: null,
    created_at: d,
  });
  const [row] = buildAskRows({
    inventory: [v],
    scores: [],
    notes: [note('2020-01-01', 'tight'), note('2025-05-01', 'lovely now')],
    maturity: new Map(),
    critics: new Map([['vn', { text: 'Classic Pauillac.' }]]),
    year: YEAR,
  });
  assert.match(row.my_notes[0], /lovely now/);
  assert.equal(row.critics, 'Classic Pauillac.');
});

function cellar(): AskRow[] {
  return rowsFrom([
    line({ cellar_id: 'paris', cellar_name: 'Paris', region: 'Bordeaux', quantity: 6 }),
    line({
      cellar_id: 'paris',
      cellar_name: 'Paris',
      region: 'Bordeaux',
      quantity: 4,
      unit_price: null,
    }),
    line({
      cellar_id: 'paris',
      cellar_name: 'Paris',
      region: 'Burgundy',
      appellation: 'Volnay',
      sub_region: 'Côte de Beaune',
      grapes: ['Pinot Noir'],
      quantity: 3,
    }),
    line({
      cellar_id: 'or',
      cellar_name: 'Oregon',
      country: 'United States',
      region: 'Oregon',
      sub_region: 'Willamette Valley',
      appellation: 'Dundee Hills',
      grapes: ['Pinot Noir'],
      wine_name: 'Old Pinot',
      drink_from: 2012,
      drink_to: 2024,
      quantity: 2,
      unit_price: 60,
      currency: 'USD',
    }),
    line({
      cellar_id: 'or',
      cellar_name: 'Oregon',
      country: 'United States',
      region: 'Oregon',
      appellation: 'Eola-Amity Hills',
      grapes: ['Pinot Noir'],
      wine_name: 'Young Pinot',
      vintage: 2023,
      drink_from: 2028,
      drink_to: 2040,
      quantity: 5,
      unit_price: 50,
      currency: 'USD',
    }),
    line({ cellar_id: 'or', cellar_name: 'Oregon', quantity: 0, quantity_on_order: 12 }),
  ]);
}

test('find_wines counts Bordeaux in Paris exactly', () => {
  const r = findWines(cellar(), { cellars: ['paris'], place: 'bordeaux' });
  assert.equal(r.matched.wines, 2);
  assert.equal(r.matched.bottles, 10);
  assert.deepEqual(r.matched.paid, [{ currency: 'EUR', total: 600, bottles_priced: 6 }]);
  assert.equal(r.matched.bottles_without_price, 4);
});

test('find_wines sorts by maturity, and the past-window wine comes first', () => {
  const r = findWines(cellar(), { cellars: ['Oregon'], sort: 'most_mature' });
  assert.equal(r.wines[0].wine, 'Old Pinot 2010');
  assert.equal(r.wines.at(-1)!.wine, 'Young Pinot 2023');
  assert.equal(r.wines[0].ready, 'Drink up: past its window');
});

test('find_wines matches accents and word starts, and groups', () => {
  const rows = cellar();
  assert.equal(findWines(rows, { place: 'cote de beaune' }).matched.wines, 1);
  assert.equal(findWines(rows, { grape: 'pinot' }).matched.bottles, 10);
  assert.equal(findWines(rows, { place: 'on' }).matched.wines, 0);
  const g = findWines(rows, { group_by: 'cellar' });
  assert.deepEqual(
    g.groups!.map((x) => [x.key, x.bottles]),
    [
      ['Paris', 13],
      ['Oregon', 7],
    ],
  );
});

test('wines only on order are left out unless asked for', () => {
  const rows = cellar();
  assert.equal(findWines(rows, { cellars: ['Oregon'] }).matched.wines, 2);
  const ordered = findWines(rows, { on_order_only: true });
  assert.equal(ordered.matched.wines, 1);
  assert.equal(ordered.matched.on_order, 12);
});

test('limits and unknown tools are handled', () => {
  const rows = cellar();
  const r = findWines(rows, { limit: 2 });
  assert.equal(r.wines.length, 2);
  assert.equal(r.more_not_listed, 3);
  assert.deepEqual(runTool(rows, 'nope', {}), { error: 'No tool called nope.' });
  const d = runTool(rows, 'wine_details', { ids: [rows[0].id, rows[0].id, 'missing'] }, [
    { wine_id: rows[0].wine_id, dishes: ['Roast lamb'] },
  ]) as { wines: { dishes: string[] }[] };
  assert.equal(d.wines.length, 1);
  assert.deepEqual(d.wines[0].dishes, ['Roast lamb']);
});

test('rows from the app are cleaned, answers keep only real wine ids', () => {
  const rows = cleanRows([
    { id: 'v1', name: 'A', ready: 'weird', bottles: -3 },
    { name: 'no id' },
    7,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ready, 'unknown');
  assert.equal(rows[0].bottles, 0);
  assert.deepEqual(cleanAnswer({ answer: ' Yes. ', wine_ids: ['v1', 'v1', 'zzz', 3] }, rows), {
    answer: 'Yes.',
    wine_ids: ['v1'],
  });
  assert.equal(cleanAnswer({ answer: '' }, rows), null);
});
