import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanPicks,
  leftovers,
  pickPrompt,
} from '../../../supabase/functions/sync-cellartracker/claudeMatch.ts';

const rows = [
  {
    iWine: '1',
    Vintage: '2005',
    Wine: 'Bodegas AAlto Ribera del Duero AAlto',
    Appellation: 'Ribera del Duero',
  },
  {
    iWine: '2',
    Vintage: '2005',
    Wine: 'Bodegas AAlto Ribera del Duero P.S.',
    Appellation: 'Ribera del Duero',
  },
  { iWine: '3', Vintage: '2010', Wine: 'Château Léoville Barton', Appellation: 'St. Julien' },
  { iWine: '4', Vintage: '2019', Wine: 'Ridge Monte Bello', Appellation: '' },
  { iWine: '5', Vintage: '1001', Wine: 'Krug Champagne Grande Cuvée', Appellation: '' },
];
const vintages = [
  { vintage_id: 'a', wine_name: 'Aalto', year: 2005 },
  { vintage_id: 'b', wine_name: 'Aalto PS', year: 2005 },
  { vintage_id: 'c', wine_name: 'Leoville Barton', year: 2010 },
  { vintage_id: 'd', wine_name: 'Ridge Monte Bello', year: 2019 },
  { vintage_id: 'e', wine_name: 'Seavey', year: 2008 },
  { vintage_id: 'f', wine_name: 'Krug Grande Cuvee', year: null },
];

test('leftovers skip matched wines and years with no candidates', () => {
  const l = leftovers(rows, vintages, new Set(['d']), new Set(['4']));
  assert.deepEqual(
    l.apps.map((a) => a.vintage_id),
    ['a', 'b', 'c', 'f'],
  );
  assert.equal(
    l.candidates.get('2019'),
    undefined,
    'used CellarTracker wines are not offered again',
  );
  assert.equal(l.candidates.get('null')?.[0].iWine, '5', 'non-vintage pairs with 1001');
});

test('the prompt groups app wines with same-vintage candidates', () => {
  const text = pickPrompt(leftovers(rows, vintages, new Set(['d']), new Set(['4'])));
  assert.match(text, /Vintage 2005\n App wines:\n  app a \| Aalto\n  app b \| Aalto PS/);
  assert.match(text, /ct 2 \| Bodegas AAlto Ribera del Duero P\.S\. \(Ribera del Duero\)/);
  assert.match(text, /Vintage NV/);
});

test('picks are checked: same year, real candidate, each used once', () => {
  const l = leftovers(rows, vintages, new Set(['d']), new Set(['4']));
  const picks = cleanPicks(
    {
      picks: [
        { vintage_id: 'a', ct_id: '1' },
        { vintage_id: 'b', ct_id: '1' }, // already taken
        { vintage_id: 'c', ct_id: '2' }, // wrong year
        { vintage_id: 'f', ct_id: '5' },
        { vintage_id: 'zzz', ct_id: '3' }, // not asked
        { vintage_id: 'e', ct_id: null },
      ],
    },
    l,
  );
  assert.deepEqual([...picks.keys()], ['a', 'f']);
  assert.equal(picks.get('a')?.iWine, '1');
  assert.equal(cleanPicks(null, l).size, 0);
});
