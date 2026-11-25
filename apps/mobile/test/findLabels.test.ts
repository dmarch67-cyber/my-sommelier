import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assign,
  cleanPages,
  imageCandidates,
  isBlocked,
  nameWords,
  robotsAllows,
  sniff,
} from '../../../supabase/functions/find-labels/prompt.ts';

const wine = {
  id: 'w1',
  name: 'Elio Grasso Barolo Gavarini Vigna Chiniera',
  producer: 'Elio Grasso',
  country: 'Italy',
  region: 'Piedmont',
  appellation: null,
  colour: 'red',
  vintages: [{ id: 'v16', year: 2016 }],
};

test('never takes pages from blocked sites', () => {
  assert.equal(isBlocked('https://www.cellartracker.com/wine.asp?iWine=1'), true);
  assert.equal(isBlocked('https://app.vinous.com/x'), true);
  assert.equal(isBlocked('https://www.wine.com/product/x'), true);
  assert.equal(isBlocked('https://www.elioGrasso.it/barolo'), false);
  assert.deepEqual(
    cleanPages({
      pages: [
        { url: 'https://www.vivino.com/x', kind: 'shop' },
        { url: 'https://eliograsso.it/chiniera', kind: 'producer', year: null },
        { url: 'https://eliograsso.it/chiniera', kind: 'producer', year: 2016 },
        { url: 'ftp://x', kind: 'other' },
      ],
    }),
    [{ url: 'https://eliograsso.it/chiniera', kind: 'producer', year: null }],
  );
});

test('finds bottle pictures on a page and skips logos', () => {
  const html = `
    <meta property="og:image" content="https://x.com/img/chiniera.jpg">
    <script type="application/ld+json">{"@type":"Product","image":["https:\\/\\/x.com\\/p\\/1.png"]}</script>
    <img src="/logo.png" alt="Elio Grasso">
    <img src="/media/gavarini-chiniera-bottle.webp" alt="Gavarini Chiniera">
    <img srcset="/a-300.jpg 300w, /a-900.jpg 900w" alt="Barolo Gavarini bottle">
    <img src="/footer/map.jpg" alt="Map">`;
  const got = imageCandidates(html, 'https://x.com/wines/chiniera', nameWords(wine));
  assert.deepEqual(got, [
    'https://x.com/p/1.png',
    'https://x.com/img/chiniera.jpg',
    'https://x.com/media/gavarini-chiniera-bottle.webp',
    'https://x.com/a-900.jpg',
  ]);
});

test('reads robots.txt for all robots', () => {
  const robots = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /cart\nAllow: /';
  assert.equal(robotsAllows(robots, '/wines/x'), true);
  assert.equal(robotsAllows(robots, '/cart/1'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/a'), false);
  assert.equal(
    robotsAllows('User-agent: *\nDisallow: /shop/\nAllow: /shop/wine', '/shop/wine-1'),
    true,
  );
});

test('gives each vintage the label showing its own year, close-ups first', () => {
  const seen = (
    number: number,
    year: number | null,
    view: 'label' | 'bottle' | 'other',
    matches = true,
    clear = true,
  ) => ({ number, shows: '', matches, year, view, clear });
  const vintages = [
    { id: 'v18', year: 2018 },
    { id: 'v19', year: 2019 },
    { id: 'v20', year: 2020 },
  ];
  const look = {
    pictures: [
      seen(1, 2018, 'bottle'),
      seen(2, 2018, 'label'),
      seen(3, 2019, 'bottle'),
      seen(4, 2020, 'label', false), // a different wine
      seen(5, 2020, 'label', true, false), // too blurry
      seen(6, 2021, 'label'),
      seen(7, null, 'other'),
    ],
  };
  const { byVintage, wine } = assign(look, 7, vintages);
  assert.deepEqual(Object.fromEntries(byVintage), { v18: 2, v19: 3 });
  assert.equal(wine, 6); // newest clear close-up stands in for 2020
  assert.deepEqual(assign({ pictures: [seen(1, 2018, 'other')] }, 1, vintages).wine, null);
  assert.equal(assign(null, 0, vintages).byVintage.size, 0);
  assert.equal(assign({ pictures: [seen(9, 2018, 'label')] }, 2, vintages).wine, null);
});

test('recognises picture formats from their bytes', () => {
  assert.equal(sniff(new Uint8Array([0xff, 0xd8, 0xff])), 'image/jpeg');
  assert.equal(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(sniff(new TextEncoder().encode('<svg')), null);
});
