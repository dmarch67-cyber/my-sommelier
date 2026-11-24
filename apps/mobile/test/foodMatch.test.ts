import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanMatches,
  MATCH_SCHEMA,
  MAX_DISHES,
  userText,
  type WineToMatch,
} from '../../../supabase/functions/match-food/prompt.ts';

const wines: WineToMatch[] = [
  {
    id: 'w1',
    account_id: 'a1',
    name: 'Ridge Monte Bello',
    producer: 'Ridge',
    country: 'USA',
    region: 'California',
    sub_region: null,
    appellation: 'Santa Cruz Mountains',
    colour: 'red',
    body: 'full',
    grapes: ['Cabernet Sauvignon', 'Merlot'],
  },
  {
    id: 'w2',
    account_id: 'a1',
    name: 'Mystery Cuvée',
    producer: null,
    country: null,
    region: null,
    sub_region: null,
    appellation: null,
    colour: null,
    body: null,
    grapes: [],
  },
];

test('the ask lists each wine once with its facts', () => {
  const text = userText(wines);
  assert.match(
    text,
    /wine w1 \| Ridge Monte Bello \| producer: Ridge \| Santa Cruz Mountains, California, USA \| red, full body \| grapes: Cabernet Sauvignon\/Merlot/,
  );
  assert.match(text, /wine w2 \| Mystery Cuvée$/m);
});

test('the schema asks for dishes, avoid and older for every wine', () => {
  assert.deepEqual(MATCH_SCHEMA.properties.wines.items.required, [
    'wine_id',
    'dishes',
    'avoid',
    'older',
  ]);
});

test('answers are cleaned: unknown ids, blanks and repeats dropped, too many cut', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ dish: `Dish ${i}`, why: 'Works.' }));
  const out = cleanMatches(
    {
      wines: [
        {
          wine_id: 'w1',
          dishes: [
            { dish: '  Roast leg of lamb ', why: 'The firm tannins love the fat.' },
            { dish: 'roast leg of lamb', why: 'Again.' },
            { dish: '', why: 'No name.' },
            { dish: 'Ribeye steak', why: '' },
            ...many,
          ],
          avoid: 'Skip spicy Thai; the heat clashes with the oak.',
          older: '  ',
        },
        { wine_id: 'nope', dishes: many, avoid: null, older: null },
      ],
    },
    wines,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].wine_id, 'w1');
  assert.equal(out[0].account_id, 'a1');
  assert.equal(out[0].dishes.length, MAX_DISHES);
  assert.deepEqual(out[0].dishes[0], {
    dish: 'Roast leg of lamb',
    why: 'The firm tannins love the fat.',
  });
  assert.equal(out[0].avoid, 'Skip spicy Thai; the heat clashes with the oak.');
  assert.equal(out[0].older, null);
});

test('a wine with fewer than two dishes is left to ask again', () => {
  const out = cleanMatches(
    {
      wines: [
        { wine_id: 'w2', dishes: [{ dish: 'Cheese', why: 'Fine.' }], avoid: null, older: null },
      ],
    },
    wines,
  );
  assert.deepEqual(out, []);
  assert.deepEqual(cleanMatches(null, wines), []);
});
