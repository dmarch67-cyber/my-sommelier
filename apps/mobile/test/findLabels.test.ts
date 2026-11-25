import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chosen,
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
  years: [2016],
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
        { url: 'https://eliograsso.it/chiniera', kind: 'producer' },
        { url: 'https://eliograsso.it/chiniera', kind: 'producer' },
        { url: 'ftp://x', kind: 'other' },
      ],
    }),
    [{ url: 'https://eliograsso.it/chiniera', kind: 'producer' }],
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

test('keeps a picture only when the checker is sure it matches', () => {
  const p = (matches: boolean) => [{ number: 1, shows: '', matches }];
  assert.equal(chosen({ pictures: p(true), best: 1, confidence: 'high' }, 1), 1);
  assert.equal(chosen({ pictures: p(true), best: 1, confidence: 'low' }, 1), null);
  assert.equal(chosen({ pictures: p(false), best: 1, confidence: 'high' }, 1), null);
  assert.equal(chosen({ pictures: p(true), best: 2, confidence: 'high' }, 1), null);
  assert.equal(chosen(null, 1), null);
});

test('recognises picture formats from their bytes', () => {
  assert.equal(sniff(new Uint8Array([0xff, 0xd8, 0xff])), 'image/jpeg');
  assert.equal(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(sniff(new TextEncoder().encode('<svg')), null);
});
