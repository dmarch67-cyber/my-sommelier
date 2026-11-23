import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BATCH_SIZE,
  cleanFill,
  FILL_SCHEMA,
  userText,
  type WineToFill,
} from '../../../supabase/functions/enrich-wines/prompt.ts';

const wines: WineToFill[] = [
  {
    id: 'w1',
    name: 'Ridge Monte Bello',
    producer: null,
    country: 'USA',
    region: 'California',
    appellation: 'Santa Cruz Mountains',
    vintages: [
      { id: 'v19', year: 2019 },
      { id: 'v13', year: 2013 },
    ],
  },
  {
    id: 'w2',
    name: 'Krug Grande Cuvée',
    producer: null,
    country: 'France',
    region: 'Champagne',
    appellation: null,
    vintages: [{ id: 'nv', year: null }],
  },
];

test('the prompt lists every wine and vintage id', () => {
  const text = userText(wines, 2026);
  assert.match(text, /Current year: 2026/);
  assert.match(text, /wine w1 \| Ridge Monte Bello \| Santa Cruz Mountains, California, USA/);
  assert.match(text, /v19=2019; v13=2013/);
  assert.match(text, /nv=NV/);
});

test('a good answer becomes fill-ins', () => {
  const fills = cleanFill(
    {
      wines: [
        {
          wine_id: 'w1',
          identified: true,
          colour: 'red',
          body: 'full',
          producer: ' Ridge ',
          grapes: ['Cabernet Sauvignon', 'Merlot', 'Merlot', ''],
          vintages: [
            { vintage_id: 'v19', drink_from: 2029, drink_to: 2055 },
            { vintage_id: 'v13', drink_from: 2023, drink_to: 2050 },
          ],
        },
        {
          wine_id: 'w2',
          identified: true,
          colour: 'sparkling',
          body: 'medium',
          producer: 'Krug',
          grapes: ['Chardonnay', 'Pinot Noir', 'Meunier'],
          vintages: [{ vintage_id: 'nv', drink_from: 2026, drink_to: 2036 }],
        },
      ],
    },
    wines,
    2026,
  );
  assert.deepEqual(fills[0], {
    wine_id: 'w1',
    colour: 'red',
    body: 'full',
    producer: 'Ridge',
    grapes: ['Cabernet Sauvignon', 'Merlot'],
    vintages: [
      { vintage_id: 'v19', drink_from: 2029, drink_to: 2055 },
      { vintage_id: 'v13', drink_from: 2023, drink_to: 2050 },
    ],
  });
  assert.equal(fills[1].colour, 'sparkling');
  assert.equal(fills[1].vintages.length, 1);
});

test('unknowns, strangers and impossible windows are dropped', () => {
  const fills = cleanFill(
    {
      wines: [
        {
          wine_id: 'w1',
          colour: 'unknown',
          body: 'heavy',
          producer: null,
          grapes: 'Cabernet',
          vintages: [
            { vintage_id: 'v19', drink_from: 2015, drink_to: 2030 }, // before the harvest
            { vintage_id: 'v13', drink_from: 2040, drink_to: 2030 }, // backwards
            { vintage_id: 'zzz', drink_from: 2030, drink_to: 2040 }, // not asked about
          ],
        },
        { wine_id: 'other', colour: 'red' },
      ],
    },
    wines,
    2026,
  );
  assert.equal(fills.length, 2, 'one fill per wine asked about, even if missing from the answer');
  assert.deepEqual(fills[0], {
    wine_id: 'w1',
    colour: null,
    body: null,
    producer: null,
    grapes: [],
    vintages: [],
  });
  assert.deepEqual(fills[1], {
    wine_id: 'w2',
    colour: null,
    body: null,
    producer: null,
    grapes: [],
    vintages: [],
  });
});

test('nonsense answers give empty fill-ins, so the wines are not asked about forever', () => {
  assert.equal(cleanFill(null, wines, 2026).length, 2);
  assert.equal(cleanFill({ wines: 'x' }, wines, 2026)[0].colour, null);
});

test('schema and batch size are sensible', () => {
  assert.ok(BATCH_SIZE > 0 && BATCH_SIZE <= 25);
  assert.deepEqual(FILL_SCHEMA.properties.wines.items.properties.colour.enum.at(-1), 'unknown');
});
