import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ctColour,
  exportUrl,
  looksLikeExport,
  matchRows,
  nameFit,
  parseCsv,
  parseScore,
  ctPlace,
  rowFacts,
  words,
} from '../../../supabase/functions/sync-cellartracker/ct.ts';

const CSV = [
  'iWine,Type,Color,Category,Vintage,Wine,Producer,Varietal,MasterVarietal,Quantity,BeginConsume,EndConsume,AG,WA,CT,MY',
  '4012345,Red,Red,Dry,2019,Ridge Monte Bello,Ridge,Red Bordeaux Blend,Cabernet Sauvignon,6,2029,2060,98,97+,95.4,99',
  '4012346,Red,Red,Dry,2013,Ridge Monte Bello,Ridge,Red Bordeaux Blend,Cabernet Sauvignon,1,,,,,"94",',
  '"5000001","White - Sparkling",White,Sparkling,1001,"Krug Champagne Grande Cuvée ""170ème Édition""",Krug,Champagne Blend,,2,2024,2040,96,,,',
  '5000002,White,White,Dry,2021,Bergström Chardonnay Sigrid,Bergström,Chardonnay,Chardonnay,3,2024,2032,,,,',
  '6000001,Red,Red,Dry,2016,Château Lafon-Rochet,Château Lafon-Rochet,Red Bordeaux Blend,,4,2026,2045,,94-96,,',
  '7000001,Red,Red,Dry,2016,Domaine Serene Pinot Noir Evenstad Reserve,Domaine Serene,Pinot Noir,Pinot Noir,1,2022,2030,,,,',
  '7000002,Red,Red,Dry,2016,Domaine Serene Pinot Noir Grace Vineyard,Domaine Serene,Pinot Noir,Pinot Noir,1,2022,2030,,,,',
].join('\r\n');

test('the export address carries the login and asks for CSV', () => {
  const url = new URL(exportUrl('dan', 'p&ss word'));
  assert.equal(url.host, 'www.cellartracker.com');
  assert.equal(url.searchParams.get('Password'), 'p&ss word');
  assert.equal(url.searchParams.get('Format'), 'csv');
  assert.equal(url.searchParams.get('Table'), 'List');
});

test('CSV with quotes and CRLF parses', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 7);
  assert.equal(rows[2].Wine, 'Krug Champagne Grande Cuvée "170ème Édition"');
  assert.equal(rows[1].CT, '94');
  assert.ok(looksLikeExport(rows));
  assert.ok(!looksLikeExport(parseCsv('<html>Please log in</html>')));
});

test('scores parse, nonsense does not', () => {
  assert.deepEqual(parseScore('97+'), {
    raw_value: '97+',
    value_low: 97,
    value_high: null,
    is_plus: true,
  });
  assert.deepEqual(parseScore('94-96'), {
    raw_value: '94-96',
    value_low: 94,
    value_high: 96,
    is_plus: false,
  });
  assert.equal(parseScore('96-94'), null);
  assert.equal(parseScore('NR'), null);
  assert.equal(parseScore('120'), null);
});

test('colours come from the type', () => {
  const rows = parseCsv(CSV);
  assert.equal(ctColour(rows[0]), 'red');
  assert.equal(ctColour(rows[2]), 'sparkling');
  assert.equal(ctColour({ Type: 'White - Sweet/Dessert' }), 'sweet');
  assert.equal(ctColour({ Type: 'Rosé' }), 'rose');
});

test('names compare without accents, Château or word order', () => {
  assert.deepEqual(words('Château Lafon-Rochet'), ['lafon', 'rochet']);
  assert.ok(nameFit('Bergstrom Sigrid Chardonnay', 'Bergström Chardonnay Sigrid') > 0.9);
  assert.ok(nameFit('Lafon Rochet', 'Château Lafon-Rochet') > 0.9);
  assert.equal(nameFit('Ridge Monte Bello', 'Ridge Lytton Springs'), 0);
});

test('row facts: window, scores (owner score left out), grapes', () => {
  const f = rowFacts(parseCsv(CSV)[0]);
  assert.equal(f.ct_id, '4012345');
  assert.equal(f.drink_from, 2029);
  assert.equal(f.drink_to, 2060);
  assert.deepEqual(f.grapes, ['Cabernet Sauvignon']);
  assert.deepEqual(
    f.scores.map((s) => [s.source, s.raw_value]),
    [
      ['cellartracker', '95.4'],
      ['vinous', '98'],
      ['wine_advocate', '97+'],
    ],
  );
  assert.deepEqual(rowFacts(parseCsv(CSV)[1]).drink_from, null);
  assert.deepEqual(rowFacts(parseCsv(CSV)[4]).grapes, [], 'a "Red Bordeaux Blend" is not a grape');
});

test('place parts come through, "Unknown" left out', () => {
  assert.deepEqual(
    ctPlace({
      Country: 'USA',
      Region: 'California',
      SubRegion: 'Napa Valley',
      Appellation: 'Oakville',
    }),
    { country: 'USA', region: 'California', sub_region: 'Napa Valley', appellation: 'Oakville' },
  );
  assert.deepEqual(
    ctPlace({ Country: 'France', Region: 'Bordeaux', SubRegion: 'Unknown', Appellation: '' }),
    { country: 'France', region: 'Bordeaux', sub_region: null, appellation: null },
  );
});

test('matching: same year and best name; ties and strangers are left alone', () => {
  const { matches, unmatchedApp, unmatchedCt } = matchRows(parseCsv(CSV), [
    { vintage_id: 'a', wine_name: 'Ridge Monte Bello', year: 2019 },
    { vintage_id: 'b', wine_name: 'Ridge Monte Bello', year: 2013 },
    { vintage_id: 'c', wine_name: 'Krug Grande Cuvée', year: null },
    { vintage_id: 'd', wine_name: 'Bergstrom Sigrid Chardonnay', year: 2021 },
    { vintage_id: 'e', wine_name: 'Lafon Rochet', year: 2016 },
    { vintage_id: 'f', wine_name: 'Domaine Serene Pinot Noir', year: 2016 },
    { vintage_id: 'g', wine_name: 'Ridge Monte Bello', year: 2018 },
  ]);
  const by = new Map(matches.map((m) => [m.vintage_id, m]));
  assert.equal(by.get('a')?.ct_id, '4012345');
  assert.equal(by.get('b')?.ct_id, '4012346');
  assert.equal(by.get('c')?.colour, 'sparkling');
  assert.equal(by.get('d')?.ct_id, '5000002');
  assert.equal(by.get('e')?.scores[0].value_high, 96);
  assert.ok(!by.has('f'), 'two Domaine Serene Pinots fit equally: not guessed');
  assert.ok(!by.has('g'), 'no 2018 in CellarTracker');
  assert.equal(unmatchedApp, 2);
  assert.equal(unmatchedCt, 2);
});

test('own notes: Notes export first, a bare MY score only when there is no note', async () => {
  const { ownNotes, ctDate } = await import('../../../supabase/functions/sync-cellartracker/ct.ts');
  assert.equal(ctDate('5/4/2019'), '2019-05-04');
  assert.equal(ctDate('2021-11-03 00:00'), '2021-11-03');
  assert.equal(ctDate(''), null);
  const list = [
    { iWine: '1', MY: '95' },
    { iWine: '2', MY: '91' },
    { iWine: '3', MY: '' },
    { iWine: '9', MY: '99' }, // not in the app
  ];
  const notes = [
    { iNote: '700', iWine: '1', TastingDate: '5/4/2019', Rating: '96', TastingNotes: 'Superb.' },
    { iNote: '701', iWine: '3', TastingDate: '1/2/2020', Rating: '0', TastingNotes: '' },
  ];
  const matches = [
    { vintage_id: 'v1', ct_id: '1' },
    { vintage_id: 'v2', ct_id: '2' },
    { vintage_id: 'v3', ct_id: '3' },
  ];
  assert.deepEqual(ownNotes(list, notes, matches), [
    {
      vintage_id: 'v1',
      source_ref: 'ct:700',
      tasted_on: '2019-05-04',
      rating: 96,
      notes: 'Superb.',
    },
    { vintage_id: 'v2', source_ref: 'score:2', tasted_on: null, rating: 91, notes: null },
  ]);
});
