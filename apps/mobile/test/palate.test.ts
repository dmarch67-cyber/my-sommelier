import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CellarItem, InventoryRow } from '../src/logic/cellar.ts';
import { buildProfile, palateFit, palateText, palateWeight } from '../src/logic/palate.ts';
import { parseAsk, recommend } from '../src/logic/tonight.ts';

type W = {
  id: string;
  name: string;
  producer: string;
  country: string;
  region: string;
  colour: string;
  body: string;
  grapes: string[];
  bought: number;
  drunk: number;
};

const WINES: W[] = [
  {
    id: 'aalto',
    name: 'Aalto',
    producer: 'Aalto',
    country: 'Spain',
    region: 'Castilla y León',
    colour: 'red',
    body: 'full',
    grapes: ['Tempranillo'],
    bought: 40,
    drunk: 30,
  },
  {
    id: 'saxum',
    name: 'Saxum James Berry',
    producer: 'Saxum',
    country: 'USA',
    region: 'California',
    colour: 'red',
    body: 'full',
    grapes: ['Grenache', 'Syrah'],
    bought: 60,
    drunk: 10,
  },
  {
    id: 'lb',
    name: 'Léoville Barton',
    producer: 'Léoville Barton',
    country: 'France',
    region: 'Bordeaux',
    colour: 'red',
    body: 'full',
    grapes: ['Cabernet Sauvignon', 'Merlot'],
    bought: 50,
    drunk: 20,
  },
  {
    id: 'chard',
    name: 'Walter Scott Chardonnay',
    producer: 'Walter Scott',
    country: 'USA',
    region: 'Oregon',
    colour: 'white',
    body: 'medium',
    grapes: ['Chardonnay'],
    bought: 8,
    drunk: 2,
  },
  {
    id: 'bad',
    name: 'Some Pinot',
    producer: 'Someone',
    country: 'USA',
    region: 'Oregon',
    colour: 'red',
    body: 'light',
    grapes: ['Pinot Noir'],
    bought: 6,
    drunk: 1,
  },
];

function row(w: W): InventoryRow {
  return {
    holding_id: `h-${w.id}`,
    account_id: 'a',
    cellar_id: 'c',
    cellar_name: 'LA home',
    wine_id: w.id,
    wine_name: w.name,
    producer: w.producer,
    country: w.country,
    region: w.region,
    appellation: null,
    colour: w.colour,
    vintage_id: `v-${w.id}`,
    vintage: 2015,
    drink_from: 2020,
    drink_to: 2035,
    bottle_size_ml: 750,
    bottle_size_label: '750ml',
    is_non_standard_size: false,
    quantity: w.bought - w.drunk,
    quantity_on_order: 0,
    unit_price: null,
    currency: null,
    body: w.body,
    grapes: w.grapes,
  };
}

function item(w: W): CellarItem {
  return {
    vintageId: `v-${w.id}`,
    wineId: w.id,
    wineName: w.name,
    vintage: 2015,
    country: w.country,
    region: w.region,
    subRegion: null,
    appellation: null,
    colour: w.colour,
    body: w.body,
    grapes: w.grapes,
    producer: w.producer,
    bottles: w.bought - w.drunk,
    magnums: 0,
    otherSizes: 0,
    onOrder: 0,
    cellarNames: ['LA home'],
    score: 93,
    scoreText: '93',
    drinkFrom: 2020,
    drinkTo: 2035,
  };
}

const rows = WINES.map(row);
const drinking = WINES.map((w) => ({ vintage_id: `v-${w.id}`, bought: w.bought, drunk: w.drunk }));
const items = WINES.map(item);

test('the profile comes from what is bought and, above all, drunk', () => {
  const p = buildProfile({ rows, drinking, notes: [] });
  assert.equal(p.bottlesBought, 164);
  assert.equal(p.bottlesDrunk, 63);
  assert.equal(p.style.colour, 'red');
  assert.equal(p.favourites[0].label, 'Aalto', 'drinks Aalto fastest');
  assert.match(p.headline, /full-bodied reds/);
  assert.match(p.headline, /open fastest are Aalto/);
  assert.ok(p.lines.some((l) => l.key === 'producer:Aalto'));
  assert.equal(p.quizLine, null);
});

test('own notes: thumbs down marks a wine as not for them; thumbs up counts as loved', () => {
  const p = buildProfile({
    rows,
    drinking,
    notes: [
      { vintage_id: 'v-bad', rating: null, liked: false },
      { vintage_id: 'v-saxum', rating: 96 },
    ],
  });
  assert.ok(p.notForMe.has('bad'));
  assert.deepEqual(p.loved, ['Saxum James Berry']);
  assert.equal(p.ownNotes, 2);
  assert.ok(p.lines.some((l) => l.key === 'dislike:bad'));
  assert.equal(palateFit(items[4], p).notForMe, true);
});

test('"not really" removes a line and its pull', () => {
  const before = buildProfile({ rows, drinking, notes: [] });
  const after = buildProfile({ rows, drinking, notes: [], notReally: ['producer:Aalto'] });
  assert.ok(!after.lines.some((l) => l.key === 'producer:Aalto'));
  assert.ok(palateFit(items[0], after).fit < palateFit(items[0], before).fit);
});

test('quiz answers change the fit and show in words', () => {
  const lean = buildProfile({
    rows,
    drinking,
    notes: [],
    quiz: { colour: 'white', body: 'medium', oak: 'some' },
  });
  const red = buildProfile({
    rows,
    drinking,
    notes: [],
    quiz: { colour: 'red', body: 'full', redStyle: 'spain' },
  });
  assert.ok(
    palateFit(items[3], lean).fit > palateFit(items[3], red).fit,
    'white fan likes the Chardonnay more',
  );
  assert.ok(palateFit(items[0], red).fit > palateFit(items[0], lean).fit);
  assert.equal(lean.quizLine, 'From your quiz: some oak.');
  assert.match(palateText(red), /Tempranillo and Spanish reds/);
});

test('Tonight: the palate lifts favourites; "surprise me" turns it around', () => {
  const p = buildProfile({ rows, drinking, notes: [], quiz: { adventure: 'favourites' } });
  assert.equal(palateWeight(p, false), 0.3);
  const usual = recommend(items, {
    year: 2026,
    colour: 'red',
    body: null,
    ask: parseAsk(''),
    palate: p,
  });
  assert.equal(usual.picks[0].item.wineId, 'aalto');
  assert.ok(usual.picks[0].reasons.includes('You open Aalto often'));
  const ask = parseAsk('surprise me');
  assert.equal(ask.surprise, true);
  assert.deepEqual(ask.words, []);
  const surprise = recommend(items, { year: 2026, colour: 'red', body: null, ask, palate: p });
  assert.notEqual(surprise.picks[0].item.wineId, 'aalto');
});

test('Tonight without a profile ranks as before', () => {
  const a = recommend(items, { year: 2026, colour: null, body: null, ask: parseAsk('') });
  const b = recommend(items, {
    year: 2026,
    colour: null,
    body: null,
    ask: parseAsk(''),
    palate: null,
  });
  assert.deepEqual(
    a.picks.map((x) => x.item.wineId),
    b.picks.map((x) => x.item.wineId),
  );
});
