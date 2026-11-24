import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CellarItem, TastingNote } from '../src/logic/cellar.ts';
import { parseAsk, readiness, recommend, styleLine } from '../src/logic/tonight.ts';

let n = 0;
function item(over: Partial<CellarItem>): CellarItem {
  n += 1;
  return {
    vintageId: `v${n}`,
    wineId: `w${n}`,
    wineName: `Wine ${n}`,
    vintage: 2015,
    country: 'France',
    region: null,
    appellation: null,
    colour: 'red',
    body: 'full',
    grapes: [],
    producer: null,
    bottles: 2,
    magnums: 0,
    otherSizes: 0,
    onOrder: 0,
    cellarNames: ['LA home'],
    score: 93,
    scoreText: '93',
    drinkFrom: 2020,
    drinkTo: 2032,
    ...over,
  };
}

const YEAR = 2026;
const none = parseAsk('');

test('parseAsk reads colour, body, food and leftover words', () => {
  const a = parseAsk('Grilled lamb chops tonight, something full-bodied and red');
  assert.equal(a.colour, 'red');
  assert.equal(a.body, 'full');
  assert.deepEqual(
    a.foods.map((f) => f.dish),
    ['lamb'],
  );
  assert.deepEqual(a.words, ['chops']);

  const b = parseAsk('Oysters with Champagne');
  assert.equal(b.colour, 'sparkling');
  assert.deepEqual(
    b.foods.map((f) => f.dish),
    ['oysters'],
  );

  assert.deepEqual(parseAsk('a Barolo from 2010').words, ['barolo', '2010']);
  assert.equal(parseAsk('Rosé please').colour, 'rose');
});

test('readiness: too young is left out, ending soon ranks highest', () => {
  assert.equal(readiness(2030, 2045, YEAR).excluded, true);
  const soon = readiness(2015, 2027, YEAR);
  const early = readiness(2025, 2045, YEAR);
  const mid = readiness(2018, 2034, YEAR);
  const past = readiness(2010, 2022, YEAR);
  assert.equal(soon.state, 'soon');
  assert.equal(mid.state, 'peak');
  assert.equal(early.state, 'ready');
  assert.equal(past.state, 'past');
  assert.ok(soon.fit > mid.fit && mid.fit > early.fit && early.fit > past.fit);
});

test('readiness: the blended maturity call wins over the window', () => {
  assert.equal(readiness(2020, 2040, YEAR, 'declining').state, 'soon');
  assert.equal(readiness(2020, 2040, YEAR, 'too_young').excluded, true);
  assert.equal(readiness(2028, 2040, YEAR, 'peak').excluded, false);
  assert.equal(readiness(2020, 2040, YEAR, 'past_it').state, 'past');
});

test('recommend filters by colour and body chips and skips on-order-only lines', () => {
  const red = item({ colour: 'red', body: 'full' });
  const lightRed = item({ colour: 'red', body: 'light' });
  const white = item({ colour: 'white', body: 'medium' });
  const ordered = item({ bottles: 0, onOrder: 6 });
  const all = [red, lightRed, white, ordered];

  const reds = recommend(all, { year: YEAR, colour: 'red', body: null, ask: none });
  assert.deepEqual(new Set(reds.picks.map((p) => p.item)), new Set([red, lightRed]));

  const fullReds = recommend(all, { year: YEAR, colour: 'red', body: 'full', ask: none });
  assert.deepEqual(
    fullReds.picks.map((p) => p.item),
    [red],
  );
  assert.ok(
    !recommend(all, { year: YEAR, colour: null, body: null, ask: none }).picks.some(
      (p) => p.item === ordered,
    ),
  );
});

test('recommend puts ready, well-scored wines first and leaves out young ones', () => {
  const young = item({ drinkFrom: 2031, drinkTo: 2050, score: 99 });
  const soon = item({ drinkFrom: 2012, drinkTo: 2027, score: 92 });
  const peak = item({ drinkFrom: 2018, drinkTo: 2034, score: 95 });
  const early = item({ drinkFrom: 2025, drinkTo: 2045, score: 90 });
  const r = recommend([young, soon, peak, early], {
    year: YEAR,
    colour: null,
    body: null,
    ask: none,
  });
  assert.deepEqual(
    r.picks.map((p) => p.item),
    [soon, peak, early],
  );
});

test('food in the ask favours suitable colours, grapes and places', () => {
  const syrah = item({
    wineName: 'Jamet Côte-Rôtie',
    grapes: ['Syrah'],
    region: 'Rhône',
    score: 92,
  });
  const pinot = item({ wineName: 'Pinot', grapes: ['Pinot Noir'], body: 'medium', score: 95 });
  const chablis = item({ colour: 'white', body: 'light', grapes: ['Chardonnay'], score: 96 });

  const lamb = recommend([syrah, pinot, chablis], {
    year: YEAR,
    colour: null,
    body: null,
    ask: parseAsk('lamb'),
  });
  assert.equal(lamb.picks[0].item, syrah);
  assert.equal(lamb.picks[0].dish, 'lamb');
  assert.ok(lamb.picks[0].reasons.includes('Goes with lamb'));
  assert.ok(!lamb.picks.some((p) => p.item === chablis), 'no white with lamb');

  const oysters = recommend([syrah, pinot, chablis], {
    year: YEAR,
    colour: null,
    body: null,
    ask: parseAsk('oysters'),
  });
  assert.deepEqual(
    oysters.picks.map((p) => p.item),
    [chablis],
  );

  // A colour the owner picked wins over the food; we say the food was set aside.
  const redWithFish = recommend([syrah, chablis], {
    year: YEAR,
    colour: 'red',
    body: null,
    ask: parseAsk('oysters'),
  });
  assert.equal(redWithFish.foodIgnored, true);
  assert.deepEqual(
    redWithFish.picks.map((p) => p.item),
    [syrah],
  );
});

test('names and years in the ask narrow the list when they match', () => {
  const barolo = item({ wineName: 'Giacosa Barolo', vintage: 2010 });
  const barolo2 = item({ wineName: 'Mascarello Barolo', vintage: 2013 });
  const other = item({ wineName: 'Ridge Monte Bello' });
  const r = recommend([barolo, barolo2, other], {
    year: YEAR,
    colour: null,
    body: null,
    ask: parseAsk('barolo 2010'),
  });
  assert.deepEqual(r.matchedWords, ['barolo', '2010']);
  assert.deepEqual(
    r.picks.map((p) => p.item),
    [barolo],
  );
  // Words that match nothing are ignored.
  const r2 = recommend([barolo, other], {
    year: YEAR,
    colour: null,
    body: null,
    ask: parseAsk('zzzz'),
  });
  assert.equal(r2.picks.length, 2);
});

test('wines the owner rated well get a lift and a reason', () => {
  const a = item({ score: 93 });
  const b = item({ score: 93 });
  const note: TastingNote = {
    id: 'n1',
    account_id: 'acc',
    vintage_id: b.vintageId,
    inventory_event_id: null,
    tasted_on: '2026-01-01',
    rating: 100,
    maturity: null,
    notes: null,
    food_pairing: null,
    occasion: null,
    would_buy_again: null,
    created_at: '2026-01-01',
  };
  const r = recommend([a, b], { year: YEAR, colour: null, body: null, ask: none, notes: [note] });
  assert.equal(r.picks[0].item, b);
  assert.deepEqual(r.picks[0].reasons, ['You gave it 5 stars']);
});

test('styleLine', () => {
  assert.equal(styleLine('red', 'full'), 'Full reds');
  assert.equal(styleLine('white', null), 'Whites');
  assert.equal(styleLine(null, 'light'), 'Light wines');
  assert.equal(styleLine(null, null), '');
});

test('sommelier answers keep only bottles that were offered', async () => {
  const { cleanSuggestion, cleanCandidate, userText } = await import(
    '../../../supabase/functions/suggest-wines/prompt.ts'
  );
  const offered = [cleanCandidate({ id: 'v1', name: 'Ridge | Monte\nBello', bottles: 2 })!];
  assert.equal(offered[0].name, 'Ridge Monte Bello');
  assert.equal(cleanCandidate({ id: '', name: 'x' }), null);
  const s = cleanSuggestion(
    {
      picks: [
        { id: 'v1', why: 'Lovely with lamb.' },
        { id: 'v1', why: 'again' },
        { id: 'made-up', why: 'not in the cellar' },
      ],
      note: ' Decant for an hour. ',
    },
    offered,
  );
  assert.deepEqual(s, {
    picks: [{ id: 'v1', why: 'Lovely with lamb.' }],
    note: 'Decant for an hour.',
  });
  assert.equal(cleanSuggestion({ nope: true }, offered), null);
  assert.match(userText('lamb', offered), /v1 \| Ridge Monte Bello NV/);
});

test('a grape or country in another cellar gives "none here", not a guess', () => {
  const paris = item({ wineName: 'Léoville Barton', cellarNames: ['Paris'] });
  const chard = item({
    wineName: 'Kistler Vine Hill',
    colour: 'white',
    body: 'medium',
    grapes: ['Chardonnay'],
    cellarNames: ['LA home'],
  });
  const barolo = item({ wineName: 'Giacosa Barolo', country: 'Italy', cellarNames: ['LA home'] });
  const everywhere = [paris, chard, barolo];

  const r = recommend([paris], {
    year: YEAR,
    colour: null,
    body: null,
    ask: parseAsk('a chardonnay please'),
    everywhere,
  });
  assert.equal(r.picks.length, 0);
  assert.deepEqual(r.elsewhere, [{ word: 'chardonnay', cellars: [{ name: 'LA home', wines: 1 }] }]);

  assert.deepEqual(parseAsk('something Italian').words, ['italy']);
  assert.equal(parseAsk('something Italian').foods.length, 0);
  const it = recommend(everywhere, {
    year: YEAR,
    colour: null,
    body: null,
    ask: parseAsk('Italian'),
    everywhere,
  });
  assert.deepEqual(
    it.picks.map((p) => p.item),
    [barolo],
  );

  // Found in this cellar, but the Red and Medium buttons would hide it: the ask wins.
  const halibut = recommend([chard, barolo], {
    year: YEAR,
    colour: 'red',
    body: 'medium',
    ask: parseAsk('a chardonnay wine that goes well with halibut'),
    everywhere,
  });
  assert.equal(halibut.chipsSetAside, true);
  assert.deepEqual(
    halibut.picks.map((p) => p.item),
    [chard],
  );
  assert.equal(halibut.picks[0].dish, 'halibut');
  assert.equal(halibut.foodIgnored, false);
});

test('everyday words do not knock out the match ("goes well with")', () => {
  const chard = item({
    wineName: 'Kistler Vine Hill',
    colour: 'white',
    body: 'medium',
    grapes: ['Chardonnay'],
  });
  const caldwell = item({ wineName: 'Caldwell Rocket Science', colour: 'red' });
  const r = recommend([chard, caldwell], {
    year: YEAR,
    colour: null,
    body: null,
    ask: parseAsk('a chardonnay that goes well with halibut'),
    everywhere: [chard, caldwell],
  });
  assert.deepEqual(
    r.picks.map((p) => p.item),
    [chard],
  );
  assert.equal(r.foodIgnored, false);
  assert.equal(r.picks[0].dish, 'halibut');

  // Two names that never meet: the second is skipped instead of emptying the list.
  const r2 = recommend([chard, caldwell], {
    year: YEAR,
    colour: null,
    body: null,
    ask: parseAsk('kistler caldwell'),
  });
  assert.deepEqual(
    r2.picks.map((p) => p.item),
    [chard],
  );
});
