import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CellarItem, InventoryRow } from '../src/logic/cellar.ts';
import {
  buildProfile,
  palateFit,
  palateText,
  palateWeight,
  quizPicks,
} from '../src/logic/palate.ts';
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

test('the profile comes from what is bought; how fast bottles go does not count', () => {
  const p = buildProfile({ rows, drinking, notes: [], year: 2026 });
  assert.equal(p.bottlesBought, 164);
  assert.equal(p.bottlesDrunk, 63);
  assert.equal(p.style.colour, 'red');
  assert.equal(p.favourites[0].label, 'Saxum', 'bought most, though drunk least');
  assert.match(p.headline, /^Lately you lean to full-bodied reds/);
  assert.match(p.headline, /Favourite producers: Saxum/);
  assert.ok(p.lines.some((l) => l.key === 'producer:Saxum'));
  assert.equal(p.quizLine, null);
});

test('newer vintages count more than old ones (taste changes)', () => {
  const young = rows.map((r) => (r.wine_id === 'chard' ? { ...r, vintage: 2023 } : r));
  const oldWhite = buildProfile({ rows, drinking, notes: [], year: 2026 });
  const newWhite = buildProfile({ rows: young, drinking, notes: [], year: 2026 });
  const g = (p: typeof oldWhite) => p.grapes.find((x) => x.label === 'Chardonnay')!.value;
  assert.ok(g(newWhite) > g(oldWhite));
});

test('own notes: thumbs down marks a wine as not for them; thumbs up counts as loved', () => {
  const p = buildProfile({
    rows,
    drinking,
    notes: [
      { vintage_id: 'v-bad', rating: null, liked: false, tasted_on: '2026-10-01' },
      { vintage_id: 'v-saxum', rating: 96, tasted_on: '2026-11-01' },
      { vintage_id: 'v-lb', rating: 97, tasted_on: '2008-11-01' },
    ],
    year: 2026,
  });
  assert.ok(p.notForMe.has('bad'));
  assert.deepEqual(p.loved, ['Saxum James Berry'], 'an 18-year-old score barely counts');
  assert.equal(p.ownNotes, 3);
  assert.equal(palateFit(items[1], p).why, 'You liked it last time');
  assert.ok(p.lines.some((l) => l.key === 'dislike:bad'));
  assert.equal(palateFit(items[4], p).notForMe, true);
});

test('"not really" removes a line and its pull', () => {
  const before = buildProfile({ rows, drinking, notes: [] });
  const after = buildProfile({ rows, drinking, notes: [], notReally: ['producer:Saxum'] });
  assert.ok(!after.lines.some((l) => l.key === 'producer:Saxum'));
  assert.ok(palateFit(items[1], after).fit < palateFit(items[1], before).fit);
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
  assert.equal(usual.picks[0].item.wineId, 'saxum');
  assert.ok(usual.picks[0].reasons.includes('Saxum is a favourite'));
  const ask = parseAsk('surprise me');
  assert.equal(ask.surprise, true);
  assert.deepEqual(ask.words, []);
  const surprise = recommend(items, { year: 2026, colour: 'red', body: null, ask, palate: p });
  assert.notEqual(surprise.picks[0].item.wineId, 'saxum');
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

test('multi-choice answers: several reds count; old single answers still read', () => {
  const both = buildProfile({
    rows,
    drinking,
    notes: [],
    quiz: { redStyle: ['cabernet', 'spain'] },
  });
  const cabOnly = buildProfile({ rows, drinking, notes: [], quiz: { redStyle: ['cabernet'] } });
  assert.ok(palateFit(items[0], both).fit > palateFit(items[0], cabOnly).fit, 'Aalto fits Spain');
  assert.equal(quizPicks({ colour: 'either' }, 'colour').join(), 'red,white');
  assert.equal(quizPicks({ world: 'both' }, 'world').join(), 'old,new');
  assert.equal(quizPicks({ body: ['medium', 'full'] }, 'body').join(), 'medium,full');
  // Every body picked says nothing, the same as no answer.
  const all = buildProfile({
    rows,
    drinking,
    notes: [],
    quiz: { body: ['light', 'medium', 'full'] },
  });
  const none = buildProfile({ rows, drinking, notes: [] });
  assert.equal(palateFit(items[3], all).fit, palateFit(items[3], none).fit);
  assert.match(both.quizLine ?? '', /Reds you love: Cabernet and Bordeaux blends, Tempranillo/);
});
