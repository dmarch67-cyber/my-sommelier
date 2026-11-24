import assert from 'node:assert/strict';
import { test } from 'node:test';

import ExcelJS from 'exceljs';

import {
  ALL_CELLARS,
  bestScoreByVintage,
  type Cellar,
  type InventoryRow,
  type Score,
} from '../src/logic/cellar.ts';
import { buildExport } from '../src/logic/export.ts';
import { colName, readXlsx, writeXlsx } from '../src/lib/xlsx.ts';

const cellars: Cellar[] = [
  { id: 'la', name: 'LA home', location: null, currency: 'USD', sort_order: 1 },
  { id: 'par', name: 'Paris', location: null, currency: 'EUR', sort_order: 2 },
];

let n = 0;
function row(over: Partial<InventoryRow>): InventoryRow {
  n += 1;
  return {
    holding_id: `h${n}`,
    account_id: 'a',
    cellar_id: 'la',
    cellar_name: 'LA home',
    wine_id: 'w1',
    wine_name: 'Ridge Monte Bello',
    producer: 'Ridge',
    country: 'USA',
    region: 'California',
    sub_region: 'Santa Cruz Mountains',
    appellation: 'Santa Cruz Mountains',
    colour: 'red',
    vintage_id: 'v1',
    vintage: 2015,
    drink_from: 2025,
    drink_to: 2045,
    bottle_size_ml: 750,
    bottle_size_label: 'Standard',
    is_non_standard_size: false,
    quantity: 3,
    quantity_on_order: 0,
    unit_price: 200,
    currency: 'USD',
    body: 'full',
    grapes: ['Cabernet Sauvignon', 'Merlot'],
    drink_window_source: 'blended',
    ...over,
  };
}

const inventory = [
  row({}),
  row({ bottle_size_ml: 1500, bottle_size_label: 'Magnum', quantity: 1, unit_price: 450 }),
  row({
    wine_name: 'Zzz & <Test> "Quote"',
    vintage_id: 'v2',
    vintage: null,
    quantity: 0,
    quantity_on_order: 6,
    unit_price: null,
    currency: null,
  }),
  row({ wine_name: 'Gone', vintage_id: 'v3', quantity: 0 }),
  row({
    cellar_id: 'par',
    cellar_name: 'Paris',
    wine_name: 'Château Montrose',
    vintage_id: 'v4',
    vintage: 2010,
    quantity: 12,
    unit_price: 150.5,
    currency: 'EUR',
    colour: 'rose',
  }),
];

const scores: Score[] = [
  {
    id: 's1',
    vintage_id: 'v1',
    source: 'vinous',
    source_detail: null,
    raw_value: '97',
    value_low: 97,
    value_high: null,
    is_plus: false,
    is_barrel_sample: false,
    scale_max: 100,
    reviewed_on: null,
    drink_from: null,
    drink_to: null,
    url: null,
  },
  {
    id: 's2',
    vintage_id: 'v1',
    source: 'unknown',
    source_detail: null,
    raw_value: '94.5',
    value_low: 94.5,
    value_high: null,
    is_plus: false,
    is_barrel_sample: false,
    scale_max: 100,
    reviewed_on: null,
    drink_from: null,
    drink_to: null,
    url: null,
  },
];

const base = {
  cellars,
  inventory,
  scores,
  notes: [
    {
      id: 'n1',
      account_id: 'a',
      vintage_id: 'v1',
      inventory_event_id: null,
      tasted_on: '2026-01-02',
      rating: 80,
      maturity: null,
      notes: null,
      food_pairing: null,
      occasion: null,
      would_buy_again: null,
      created_at: '2026-01-02',
    },
    {
      id: 'n2',
      account_id: 'a',
      vintage_id: 'v1',
      inventory_event_id: null,
      tasted_on: '2026-06-01',
      rating: 90,
      maturity: null,
      notes: null,
      food_pairing: null,
      occasion: null,
      would_buy_again: null,
      created_at: '2026-06-01',
    },
  ],
  maturity: new Map([['v1', 'ready' as const]]),
  bestScores: bestScoreByVintage(scores),
  today: '2026-11-24',
};

test('one cellar: rows, columns and file name', () => {
  const r = buildExport({ ...base, filter: 'la' });
  assert.equal(r.fileName, 'My Sommelier - LA home - 2026-11-24.xlsx');
  const [bottles, summary] = r.sheets;
  assert.equal(bottles.rows.length, 3, 'drunk-out lot left out, on-order kept');
  assert.equal(r.bottles, 4);
  const h = bottles.columns.map((c) => c.header);
  const first = Object.fromEntries(h.map((k, i) => [k, bottles.rows[0][i]]));
  assert.equal(first['Sub-region'], 'Santa Cruz Mountains');
  assert.equal(first['Bottle size'], 'Standard (750 ml)');
  assert.equal(first['Value'], 600);
  assert.equal(first['Best score'], 97);
  assert.equal(first['Score source'], 'Vinous');
  assert.equal(first['All scores'], 'Vinous 97; Spreadsheet 95');
  assert.equal(first['Window from'], 'Blended reviews');
  assert.equal(first['Maturity (reviews)'], 'Ready');
  assert.equal(first['My last rating (stars)'], 4.5);
  assert.equal(first['Last tasted'], '2026-06-01');
  assert.equal(first['Grapes'], 'Cabernet Sauvignon, Merlot');
  const mag = Object.fromEntries(h.map((k, i) => [k, bottles.rows[1][i]]));
  assert.equal(mag['Bottle size'], 'Magnum');
  assert.deepEqual(summary.rows, [['LA home', 2, 4, 1, 0, 6, 1050, 'USD', 0]]);
});

test('all cellars: currencies are never added together', () => {
  const r = buildExport({ ...base, filter: ALL_CELLARS });
  assert.equal(r.fileName, 'My Sommelier - All cellars - 2026-11-24.xlsx');
  const summary = r.sheets[1];
  assert.deepEqual(summary.rows[1], ['Paris', 1, 12, 0, 0, 0, 1806, 'EUR', 0]);
  assert.deepEqual(summary.footer?.[0], ['All cellars', 3, 16, 1, 0, 6, null, null, 0]);
  assert.deepEqual(summary.footer?.[1], [
    'Value in USD',
    null,
    null,
    null,
    null,
    null,
    1050,
    'USD',
    null,
  ]);
  assert.deepEqual(summary.footer?.[2], [
    'Value in EUR',
    null,
    null,
    null,
    null,
    null,
    1806,
    'EUR',
    null,
  ]);
  const paris = r.sheets[0].rows.at(-1)!;
  assert.equal(paris[0], 'Paris');
  assert.equal(paris[4], 'Rosé');
});

test('the file opens in a real spreadsheet library with the same numbers', async () => {
  const r = buildExport({ ...base, filter: ALL_CELLARS });
  const bytes = writeXlsx(r.sheets);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ['Bottles', 'Summary'],
  );
  const ws = wb.getWorksheet('Bottles')!;
  assert.equal(ws.getCell('A1').value, 'Cellar');
  assert.equal(ws.getCell('A1').font?.bold, true);
  assert.equal(ws.getCell('N2').value, 3);
  assert.equal(ws.getCell('P2').numFmt, '#,##0.00');
  assert.equal(ws.getCell('C4').value, 'Zzz & <Test> "Quote"');
  assert.equal(ws.getCell('D4').value, 'NV');
  assert.equal(ws.views[0].state, 'frozen');
  const sum = wb.getWorksheet('Summary')!;
  assert.equal(sum.getCell('C5').value, 16);
  assert.equal(ws.getCell('B1').value, 'Producer');
  assert.equal(ws.getCell('C1').value, 'Wine');
  // Our own reader (used by the delivery upload) reads it back too.
  const back = readXlsx(bytes);
  assert.equal(back[0][1], 'Producer');
  assert.equal(back[1][2], 'Ridge Monte Bello');
});

test('column letters', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colName(27), 'AB');
});
