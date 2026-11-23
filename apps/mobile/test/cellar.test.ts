import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALL_CELLARS,
  bestScoreByVintage,
  countsLine,
  fold,
  groupInventory,
  placeLine,
  ripeness,
  scoreValue,
  search,
  sortItems,
  totals,
  type InventoryRow,
  type Score,
} from '../src/logic/cellar.ts';

let n = 0;
function row(over: Partial<InventoryRow>): InventoryRow {
  n += 1;
  return {
    holding_id: `h${n}`,
    cellar_id: 'la',
    cellar_name: 'LA home',
    wine_id: 'w1',
    wine_name: 'Ridge Monte Bello',
    producer: null,
    country: 'USA',
    region: 'California',
    appellation: 'Santa Cruz',
    colour: null,
    vintage_id: 'v1',
    vintage: 2015,
    drink_from: null,
    drink_to: null,
    bottle_size_ml: 750,
    bottle_size_label: 'Standard',
    is_non_standard_size: false,
    quantity: 1,
    quantity_on_order: 0,
    unit_price: 200,
    currency: 'USD',
    ...over,
  };
}

function score(over: Partial<Score>): Score {
  n += 1;
  return {
    id: `s${n}`,
    vintage_id: 'v1',
    source: 'unknown',
    source_detail: null,
    raw_value: '95',
    value_low: 95,
    value_high: null,
    is_plus: false,
    is_barrel_sample: false,
    scale_max: 100,
    reviewed_on: null,
    drink_from: null,
    drink_to: null,
    url: null,
    ...over,
  };
}

const rows: InventoryRow[] = [
  row({ quantity: 3 }),
  row({
    bottle_size_ml: 1500,
    bottle_size_label: 'Magnum',
    is_non_standard_size: true,
    quantity: 2,
  }),
  row({ cellar_id: 'paris', cellar_name: 'Paris', quantity: 1, currency: 'EUR' }),
  row({
    vintage_id: 'v2',
    wine_id: 'w2',
    wine_name: 'Château Latour',
    country: 'France',
    region: 'Bordeaux',
    appellation: 'Pauillac',
    vintage: 2010,
    cellar_id: 'paris',
    cellar_name: 'Paris',
    quantity: 6,
  }),
  row({
    vintage_id: 'v3',
    wine_id: 'w3',
    wine_name: 'Truss',
    vintage: 2024,
    quantity: 0,
    quantity_on_order: 12,
  }),
  row({ vintage_id: 'v4', wine_id: 'w4', wine_name: 'Drunk long ago', quantity: 0 }),
];

test('groups holdings by vintage within one cellar and drops fully drunk lines', () => {
  const items = groupInventory(rows, 'la', new Map());
  assert.deepEqual(
    items.map((i) => [i.wineName, i.bottles, i.magnums, i.onOrder]),
    [
      ['Ridge Monte Bello', 5, 2, 0],
      ['Truss', 0, 0, 12],
    ],
  );
});

test('All cellars sums across cellars and lists where the bottles are', () => {
  const items = groupInventory(rows, ALL_CELLARS, new Map());
  const ridge = items.find((i) => i.vintageId === 'v1')!;
  assert.equal(ridge.bottles, 6);
  assert.deepEqual(ridge.cellarNames, ['LA home', 'Paris']);
  assert.deepEqual(totals(items), { wines: 3, bottles: 12, magnums: 2, onOrder: 12 });
});

test('search ignores accents and case, and every word must match', () => {
  const items = groupInventory(rows, ALL_CELLARS, new Map());
  assert.deepEqual(
    search(items, 'chateau').map((i) => i.wineName),
    ['Château Latour'],
  );
  assert.deepEqual(
    search(items, 'PAUILLAC 2010').map((i) => i.wineName),
    ['Château Latour'],
  );
  assert.deepEqual(search(items, 'pauillac 2015'), []);
  assert.equal(search(items, '  ').length, 3);
  assert.equal(fold('Côte-Rôtie'), 'cote rotie');
});

test('scores: plus and ranges, best per vintage, sort by score', () => {
  assert.equal(scoreValue(score({ value_low: 94, is_plus: true })), 94.5);
  assert.equal(scoreValue(score({ value_low: 92, value_high: 94 })), 93);
  assert.equal(scoreValue(score({ value_low: 18, scale_max: 20 })), 90);
  const best = bestScoreByVintage([
    score({ raw_value: '93', value_low: 93 }),
    score({ raw_value: '96', value_low: 96 }),
    score({ vintage_id: 'v2', raw_value: '98', value_low: 98 }),
  ]);
  assert.equal(best.get('v1')!.raw_value, '96');
  const items = groupInventory(rows, ALL_CELLARS, best);
  assert.deepEqual(
    sortItems(items, 'score', 2026).map((i) => i.scoreText),
    ['98', '96', null],
  );
});

test('ready-to-drink sort: windows first by urgency, then oldest vintages', () => {
  const items = groupInventory(
    [
      row({ vintage_id: 'a', wine_name: 'Young', vintage: 2022, drink_from: 2030, drink_to: 2045 }),
      row({ vintage_id: 'b', wine_name: 'Ready', vintage: 2015, drink_from: 2020, drink_to: 2035 }),
      row({ vintage_id: 'c', wine_name: 'Soon', vintage: 2012, drink_from: 2016, drink_to: 2027 }),
      row({ vintage_id: 'd', wine_name: 'No window old', vintage: 2005 }),
      row({ vintage_id: 'e', wine_name: 'No window new', vintage: 2021 }),
    ],
    ALL_CELLARS,
    new Map(),
  );
  assert.deepEqual(
    sortItems(items, 'ready', 2026).map((i) => i.wineName),
    ['Soon', 'Ready', 'No window old', 'No window new', 'Young'],
  );
});

test('region sort groups by country, region, appellation', () => {
  const items = groupInventory(rows, ALL_CELLARS, new Map());
  assert.deepEqual(
    sortItems(items, 'region', 2026).map((i) => i.wineName),
    ['Château Latour', 'Ridge Monte Bello', 'Truss'],
  );
});

test('ripeness states and bar positions', () => {
  assert.equal(ripeness(null, null, 2026).state, 'unknown');
  assert.equal(ripeness(2030, 2045, 2026).state, 'young');
  assert.equal(ripeness(2020, 2035, 2026).state, 'ready');
  assert.equal(ripeness(2016, 2027, 2026).state, 'soon');
  assert.equal(ripeness(2010, 2020, 2026).state, 'past');
  const r = ripeness(2020, 2035, 2026);
  assert.ok(r.windowStart! < r.marker! && r.marker! < r.windowEnd!);
  assert.ok(r.windowStart! >= 0 && r.windowEnd! <= 1);
  const late = ripeness(2000, 2010, 2026);
  assert.ok(late.marker! <= 1, 'now always fits on the bar');
});

test('text helpers', () => {
  assert.equal(countsLine({ bottles: 5, magnums: 2, onOrder: 0 }), '5 bottles (2 magnums)');
  assert.equal(countsLine({ bottles: 3, magnums: 3, onOrder: 0 }), '3 magnums');
  assert.equal(countsLine({ bottles: 1, magnums: 0, onOrder: 12 }), '1 bottle · 12 on order');
  assert.equal(countsLine({ bottles: 0, magnums: 0, onOrder: 12 }), '12 on order');
  assert.equal(countsLine({ bottles: 0, magnums: 0, onOrder: 0 }), '0 bottles');
  assert.equal(
    placeLine({ appellation: 'Oregon', region: 'Oregon', country: 'USA' }),
    'Oregon, USA',
  );
});
