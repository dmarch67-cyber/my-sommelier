import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanReading,
  READING_SCHEMA,
  userText,
} from '../../../supabase/functions/read-label/prompt.ts';
import type { InventoryRow } from '../src/logic/cellar.ts';
import { addParams, knownWines, matchedWineId, readingPlace } from '../src/logic/label.ts';

function row(over: Partial<InventoryRow>): InventoryRow {
  return {
    holding_id: 'h',
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

const ROWS = [
  row({}),
  row({ holding_id: 'h2', vintage: 2019 }),
  row({
    wine_id: 'w2',
    wine_name: 'Lafon Rochet',
    country: 'France',
    region: 'Bordeaux',
    appellation: 'Saint-Estèphe',
  }),
];

const KNOWN = knownWines(ROWS);

test('the cellar list sent to the reader has each wine once', () => {
  assert.deepEqual(KNOWN, [
    { id: 'w2', name: 'Lafon Rochet', place: 'Saint-Estèphe, Bordeaux, France' },
    { id: 'w1', name: 'Ridge Monte Bello', place: 'Santa Cruz, California, USA' },
  ]);
  assert.match(userText(KNOWN), /w2 \| Lafon Rochet \| Saint-Estèphe/);
  assert.match(userText([]), /\(empty\)/);
});

test('answers from the reader are checked before use', () => {
  const r = cleanReading(
    {
      is_wine_label: true,
      producer: 'Château Lafon-Rochet',
      wine_name: ' Lafon Rochet ',
      vintage: 2016,
      country: 'France',
      region: 'Bordeaux',
      appellation: 'Saint-Estèphe',
      bottle_size_ml: 1500,
      match_wine_id: 'w2',
      confidence: 'high',
      note: '',
    },
    KNOWN,
  )!;
  assert.equal(r.wine_name, 'Lafon Rochet');
  assert.equal(r.note, null);
  assert.equal(r.match_wine_id, 'w2');

  const odd = cleanReading(
    {
      is_wine_label: true,
      wine_name: 'X',
      vintage: 3020,
      bottle_size_ml: 5,
      match_wine_id: 'zzz',
      confidence: 'sure',
    },
    KNOWN,
  )!;
  assert.equal(odd.vintage, null, 'impossible years are dropped');
  assert.equal(odd.bottle_size_ml, null);
  assert.equal(odd.match_wine_id, null, 'ids not in the cellar are dropped');
  assert.equal(odd.confidence, 'low');
  assert.equal(cleanReading('nope', KNOWN), null);
  assert.equal(READING_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    [...READING_SCHEMA.required].sort(),
    Object.keys(READING_SCHEMA.properties).sort(),
  );
});

test('a reading becomes a pre-filled add', () => {
  const base = cleanReading(
    {
      is_wine_label: true,
      wine_name: 'Château Lafon-Rochet',
      vintage: 2016,
      country: 'France',
      region: 'Bordeaux',
      appellation: 'Saint-Estèphe',
      bottle_size_ml: null,
      match_wine_id: null,
      confidence: 'medium',
    },
    KNOWN,
  )!;
  // The reader missed it, but the names match once "Château" and the hyphen are ignored.
  assert.equal(matchedWineId(base, ROWS), 'w2');
  assert.deepEqual(addParams(base, 'w2'), { from: 'label', wineId: 'w2', vintage: '2016' });

  const fresh = { ...base, wine_name: 'Saxum James Berry', vintage: null, bottle_size_ml: 1500 };
  assert.equal(matchedWineId(fresh, ROWS), null);
  assert.deepEqual(addParams(fresh, null), {
    from: 'label',
    name: 'Saxum James Berry',
    country: 'France',
    region: 'Bordeaux',
    appellation: 'Saint-Estèphe',
    vintage: 'NV',
    size: '1500',
  });
  assert.equal(readingPlace(base), 'Saint-Estèphe, Bordeaux, France');
});
