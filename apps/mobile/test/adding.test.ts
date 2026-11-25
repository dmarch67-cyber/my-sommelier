import assert from 'node:assert/strict';
import { test } from 'node:test';

import ExcelJS from 'exceljs';

import {
  defaultDrinkChoice,
  drinkChoices,
  findWines,
  foldName,
  moveSizes,
  moveSummary,
  parseScore,
  parseSpokenAdd,
  spokenCellar,
} from '../src/logic/adding.ts';
import type { InventoryRow } from '../src/logic/cellar.ts';
import { parseCsv, parseDelivery, parseSize } from '../src/logic/delivery.ts';
import { readXlsx } from '../src/lib/xlsx.ts';

let n = 0;
function row(over: Partial<InventoryRow>): InventoryRow {
  n += 1;
  return {
    holding_id: `h${n}`,
    account_id: 'acc',
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
    unit_price: null,
    currency: null,
    ...over,
  };
}

const CELLARS = [
  { id: 'la', name: 'LA home' },
  { id: 'or', name: 'Oregon' },
  { id: 'paris', name: 'Paris' },
];

test('drink choices: one per cellar and size, from the fullest lot', () => {
  const rows = [
    row({ quantity: 2 }),
    row({ quantity: 4 }),
    row({ bottle_size_ml: 1500, bottle_size_label: 'Magnum', quantity: 1 }),
    row({ cellar_id: 'paris', cellar_name: 'Paris', quantity: 3 }),
    row({ cellar_id: 'or', cellar_name: 'Oregon', quantity: 0 }),
  ];
  const choices = drinkChoices(rows, ['la', 'or', 'paris']);
  assert.deepEqual(
    choices.map((c) => [c.cellarName, c.sizeMl, c.bottles]),
    [
      ['LA home', 750, 6],
      ['LA home', 1500, 1],
      ['Paris', 750, 3],
    ],
  );
  assert.equal(choices[0].holding.quantity, 4, 'takes from the lot with most bottles');
  assert.equal(
    defaultDrinkChoice(choices, 'paris')?.cellarName,
    'Paris',
    'Paris has one size: no question',
  );
  assert.equal(defaultDrinkChoice(choices, 'la'), null, 'LA has two sizes: ask');
  assert.equal(defaultDrinkChoice(choices, null), null, 'several cellars: ask');
  assert.equal(defaultDrinkChoice(choices.slice(2), null)?.cellarName, 'Paris');
});

test('finding wines by typed or spoken words', () => {
  const rows = [
    row({}),
    row({ vintage_id: 'v2', vintage: 2019 }),
    row({
      wine_id: 'w2',
      wine_name: 'Château Léoville Barton',
      appellation: 'Saint-Julien',
      region: 'Bordeaux',
      country: 'France',
    }),
    row({ wine_id: 'w3', wine_name: 'Ridge Geyserville' }),
  ];
  assert.deepEqual(
    findWines(rows, 'ridge').map((w) => w.name),
    ['Ridge Geyserville', 'Ridge Monte Bello'],
  );
  assert.deepEqual(findWines(rows, 'monte bello')[0].vintages, [2019, 2015]);
  assert.equal(findWines(rows, 'leoville')[0].name, 'Château Léoville Barton');
  assert.equal(findWines(rows, 'st julien')[0].name, 'Château Léoville Barton');
  assert.deepEqual(findWines(rows, '  '), []);
  assert.equal(foldName('Château Léoville-Barton'), 'leoville barton');
});

test('reading a spoken add', () => {
  assert.deepEqual(parseSpokenAdd('Six bottles of 2019 Ridge Monte Bello'), {
    quantity: 6,
    vintage: 2019,
    sizeMl: null,
    onOrder: false,
    query: 'ridge monte bello',
  });
  assert.deepEqual(parseSpokenAdd('two magnums of Latour 2010 on order'), {
    quantity: 2,
    vintage: 2010,
    sizeMl: 1500,
    onOrder: true,
    query: 'latour',
  });
  assert.equal(parseSpokenAdd('a case of Saxum Bone Rock 2022 to Paris').quantity, 12);
  assert.equal(parseSpokenAdd('a case of Saxum Bone Rock 2022 to Paris').query, 'saxum bone rock');
  assert.equal(parseSpokenAdd('3 bottles Truss 2024').quantity, 3);
  assert.equal(parseSpokenAdd('Truss').quantity, null);
  assert.equal(spokenCellar('a case to Paris', CELLARS), 'paris');
  assert.equal(spokenCellar('add to LA', CELLARS), 'la');
  assert.equal(spokenCellar('in Oregon please', CELLARS), 'or');
  assert.equal(spokenCellar('Monte Bello', CELLARS), null);
});

test('scores', () => {
  assert.deepEqual(parseScore('94+'), { raw: '94+', low: 94, high: null, plus: true });
  assert.deepEqual(parseScore('92-94'), { raw: '92-94', low: 92, high: 94, plus: false });
  assert.deepEqual(parseScore('17.5/20'), { raw: '17.5/20', low: null, high: null, plus: false });
  assert.equal(parseScore(' '), null);
});

test('bottle sizes', () => {
  assert.equal(parseSize('Magnum'), 1500);
  assert.equal(parseSize('1.5L'), 1500);
  assert.equal(parseSize('750ml'), 750);
  assert.equal(parseSize('375 ml'), 375);
  assert.equal(parseSize(''), null);
});

test('delivery: finds headings anywhere, reads lines, lists what it skipped', () => {
  const rows = [
    ['Acme Wine Merchants', '', '', ''],
    ['Invoice 1234', '', '', ''],
    ['Year', 'Description', 'Bottles', 'Price', 'Score'],
    ['2019', 'Ridge Monte Bello', '6', '$250.00', '97+'],
    ['', 'Château Latour 2010 1.5L', '1', '1,450', ''],
    ['NV', 'Krug Grande Cuvée', '2', '', '95'],
    ['', 'Mystery wine', '', '', ''],
    ['', '', '', '', ''],
    ['Total', '', '9', '', ''],
  ];
  const p = parseDelivery(rows);
  assert.equal(p.error, null);
  assert.deepEqual(p.columns, { vintage: 'A', wine: 'B', quantity: 'C', price: 'D', score: 'E' });
  assert.deepEqual(
    p.lines.map((l) => [
      l.row,
      l.wineName,
      l.vintage,
      l.quantity,
      l.sizeMl,
      l.unitPrice,
      l.score?.raw ?? null,
    ]),
    [
      [4, 'Ridge Monte Bello', 2019, 6, 750, 250, '97+'],
      [5, 'Château Latour', 2010, 1, 1500, 1450, null],
      [6, 'Krug Grande Cuvée', null, 2, 750, null, '95'],
    ],
  );
  assert.deepEqual(p.skipped, [{ row: 7, reason: 'No bottle count for “Mystery wine”' }]);
});

test('delivery: a sheet without headings explains itself', () => {
  const p = parseDelivery([
    ['a', 'b'],
    ['c', 'd'],
  ]);
  assert.match(p.error!, /column headings/);
});

test('CSV with quotes and commas', () => {
  assert.deepEqual(parseCsv('Wine,Qty\n"Latour, Pauillac",2\r\n"Say ""hi""",1\n'), [
    ['Wine', 'Qty'],
    ['Latour, Pauillac', '2'],
    ['Say "hi"', '1'],
  ]);
  assert.deepEqual(parseCsv('Wine;Qty\nLatour;2'), [
    ['Wine', 'Qty'],
    ['Latour', '2'],
  ]);
});

test('reads a real .xlsx file, including formulas and a later first sheet', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Delivery');
  ws.addRow(['Vintage', 'Wine', 'Qty', 'Price', 'Total']);
  ws.addRow([2019, 'Ridge Monte Bello', 6, 250, { formula: 'C2*D2', result: 1500 }]);
  ws.addRow([2010, 'Château Latour & Co <1.5L>', 1, 1450.5]);
  ws.getCell('B5').value = 'Skipped a row';
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const rows = readXlsx(bytes);
  assert.deepEqual(rows[0], ['Vintage', 'Wine', 'Qty', 'Price', 'Total']);
  assert.deepEqual(rows[1], ['2019', 'Ridge Monte Bello', '6', '250', '1500']);
  assert.equal(rows[2][1], 'Château Latour & Co <1.5L>');
  assert.equal(rows[2][3], '1450.5');
  assert.deepEqual(rows[3], []);
  assert.equal(rows[4][1], 'Skipped a row');
  const p = parseDelivery(rows);
  assert.equal(p.lines.length, 2);
});

test('moveSizes lists the sizes with bottles in one cellar', () => {
  const rows = [
    row({ cellar_id: 'la', quantity: 4 }),
    row({ cellar_id: 'la', quantity: 2 }),
    row({ cellar_id: 'la', quantity: 1, bottle_size_ml: 1500, bottle_size_label: 'Magnum' }),
    row({ cellar_id: 'paris', cellar_name: 'Paris', quantity: 3 }),
    row({ cellar_id: 'la', quantity: 0, bottle_size_ml: 375, bottle_size_label: 'Half bottle' }),
  ];
  const sizes = moveSizes(drinkChoices(rows, ['la', 'paris']), 'la');
  assert.deepEqual(
    sizes.map((s) => [s.sizeMl, s.bottles]),
    [
      [750, 6],
      [1500, 1],
    ],
  );
});

test('moveSummary reads naturally', () => {
  assert.equal(moveSummary(3, 750, 'Standard', 'Paris'), 'Moved 3 bottles to Paris.');
  assert.equal(moveSummary(1, 750, 'Standard', 'Paris'), 'Moved 1 bottle to Paris.');
  assert.equal(moveSummary(1, 1500, 'Magnum', 'Oregon'), 'Moved 1 magnum to Oregon.');
  assert.equal(moveSummary(2, 1500, 'Magnum', 'Oregon'), 'Moved 2 magnums to Oregon.');
});
