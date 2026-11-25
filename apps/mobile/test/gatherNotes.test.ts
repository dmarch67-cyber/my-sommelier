import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  budget,
  cleanNotes,
  cleanPages,
  focus,
  isBlocked,
  onPage,
  pageText,
} from '../../../supabase/functions/gather-notes/prompt.ts';
import { noteCaption, sortNotes, type CriticNote } from '../src/logic/criticNotes.ts';

const V1 = '11111111-1111-1111-1111-111111111111';
const V2 = '22222222-2222-2222-2222-222222222222';
const wine = {
  id: 'w1',
  name: 'Saxum James Berry Vineyard',
  producer: 'Saxum',
  country: 'USA',
  region: 'California',
  appellation: 'Paso Robles',
  colour: 'red',
  vintages: [
    { id: V1, year: 2016 },
    { id: V2, year: 2019 },
  ],
};

const NOTE =
  'Deep purple-black, the 2016 James Berry opens with crushed blackberries, violets and garrigue, with a full-bodied, plush palate and a long, spicy finish.';
const html = `<html><head><script>var x = "${'no'.repeat(10)}";</script><style>p{}</style></head>
<body><nav>Shop Cart</nav><h1>Saxum James Berry 2016</h1>
<p>98 points, Jeb Dunnuck</p><blockquote>${NOTE.replace(',', '&#44;')}</blockquote>
<p>Free shipping &amp; returns</p></body></html>`;

test('page text drops scripts and tags and decodes entities', () => {
  const t = pageText(html);
  assert.ok(!t.includes('var x'));
  assert.ok(t.includes('Free shipping & returns'));
  assert.ok(t.includes('Deep purple-black, the 2016'));
});

test('a note copied from the page passes; one Claude wrote itself does not', () => {
  const t = pageText(html);
  assert.equal(onPage(NOTE, t), true);
  assert.equal(onPage(NOTE.slice(0, 80) + '…', t), true);
  assert.equal(
    onPage(
      'A powerful, opulent wine with layers of black fruit, chocolate and smoke on the finish.',
      t,
    ),
    false,
  );
});

test('cleanNotes keeps real notes on owned vintages and drops the rest', () => {
  const pages = [
    {
      url: 'https://shop.example.com/saxum-2016',
      site: 'shop.example.com',
      text: pageText(html),
      pdf: false,
    },
    { url: 'https://saxum.com/tech.pdf', site: 'saxum.com', text: null, pdf: true },
  ];
  const raw = {
    notes: [
      {
        vintage_id: V1,
        author: 'Jeb Dunnuck',
        kind: 'critic',
        score: '98',
        noted_on: '2018-10',
        note: NOTE,
        page: 1,
      },
      // same note again: kept once
      {
        vintage_id: V1,
        author: 'Jeb Dunnuck',
        kind: 'critic',
        score: '98',
        noted_on: null,
        note: NOTE,
        page: 1,
      },
      // made up: not on the page
      {
        vintage_id: V1,
        author: 'Wine Advocate',
        kind: 'critic',
        score: '97',
        noted_on: null,
        note: 'Layers of cassis, mocha and graphite with a seamless, endless finish of great purity.',
        page: 1,
      },
      // a vintage not owned
      {
        vintage_id: 'nope',
        author: 'Jeb Dunnuck',
        kind: 'critic',
        score: null,
        noted_on: null,
        note: NOTE,
        page: 1,
      },
      // from the PDF (taken as given), date in the future dropped
      {
        vintage_id: V2,
        author: "Saxum (winemaker's note)",
        kind: 'winery',
        score: null,
        noted_on: '2099',
        note: 'Our 2019 shows red fruits, sage and a firm, fine-grained tannic spine.',
        page: 2,
      },
      // no such page
      {
        vintage_id: V2,
        author: 'X',
        kind: 'critic',
        score: null,
        noted_on: null,
        note: NOTE,
        page: 9,
      },
    ],
  };
  const { notes, rejected } = cleanNotes(raw, wine, pages, 2026);
  assert.equal(notes.length, 2);
  assert.equal(rejected, 3);
  assert.equal(notes[0].source_site, 'shop.example.com');
  assert.equal(notes[0].noted_on, '2018-10');
  assert.equal(notes[1].noted_on, null);
  assert.equal(notes[1].kind, 'winery');
});

test('never pages from CellarTracker, Vinous, WineBerserkers or Vivino', () => {
  for (const u of [
    'https://www.cellartracker.com/wine.asp?iWine=1',
    'https://www.vinous.com/wines/x',
    'https://www.wineberserkers.com/t/x',
    'https://vivino.com/x',
  ])
    assert.equal(isBlocked(u), true);
  const pages = cleanPages(
    {
      pages: [
        { url: 'https://www.vinous.com/x', kind: 'critic', year: 2016 },
        { url: 'https://shop.example.com/a', kind: 'shop', year: 2016 },
        { url: 'https://shop.example.com/a', kind: 'shop', year: 2016 },
        { url: 'ftp://x', kind: 'shop', year: null },
      ],
    },
    10,
  );
  assert.deepEqual(
    pages.map((p) => p.url),
    ['https://shop.example.com/a'],
  );
});

test('more vintages get more searches and pages, within limits', () => {
  assert.deepEqual(budget({ ...wine, vintages: [wine.vintages[0]] }), { searches: 4, pages: 6 });
  const many = {
    ...wine,
    vintages: Array.from({ length: 15 }, (_, i) => ({ id: `v${i}`, year: 2000 + i })),
  };
  assert.deepEqual(budget(many), { searches: 8, pages: 16 });
});

test('focus keeps the tasting-note parts of a long page', () => {
  const long = [
    'Menu',
    ...Array.from({ length: 2000 }, (_, i) => `Filler line ${i}`),
    '96 points Wine Advocate',
    NOTE,
  ].join('\n');
  const f = focus(long, 2000);
  assert.ok(f.length <= 2000);
  assert.ok(f.includes('96 points Wine Advocate'));
  assert.ok(f.includes('Deep purple-black'));
});

test('Wine page lists critics first, newest first, winery last', () => {
  const n = (id: string, kind: CriticNote['kind'], noted_on: string | null): CriticNote => ({
    id,
    author: id,
    kind,
    score: null,
    noted_on,
    note: `note by ${id}`,
    source_url: 'https://a.com',
    source_site: 'a.com',
  });
  const sorted = sortNotes([
    n('w', 'winery', '2025'),
    n('c1', 'critic', '2019'),
    n('m', 'merchant', null),
    n('c2', 'critic', '2023'),
  ]);
  assert.deepEqual(
    sorted.map((s) => s.id),
    ['c2', 'c1', 'm', 'w'],
  );
  assert.equal(noteCaption(n('w', 'winery', '2025-03')), "Winery's own note · 2025 · a.com");
  assert.equal(noteCaption(n('c', 'critic', null)), 'a.com');
});

test('the same note quoted by two shops is kept once, the dated and fuller one', async () => {
  const { dedupe, noteKey } = await import('../../../supabase/functions/gather-notes/prompt.ts');
  const base = {
    vintage_id: V1,
    kind: 'critic' as const,
    score: '97',
    source_url: 'https://a.com',
    source_site: 'a.com',
  };
  const out = dedupe([
    { ...base, author: 'Wine Advocate', noted_on: null, note: NOTE },
    {
      ...base,
      author: 'William Kelley (Wine Advocate)',
      noted_on: '2022-04',
      note: NOTE + ' Extra.',
    },
    {
      ...base,
      author: 'Jeb Dunnuck',
      noted_on: null,
      note: 'Something else entirely, quite different from the first note here.',
    },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].author, 'William Kelley (Wine Advocate)');
  const again = dedupe(
    [{ ...base, author: 'X', noted_on: null, note: NOTE }],
    new Set([noteKey(V1, NOTE)]),
  );
  assert.equal(again.length, 0);
  const shown = sortNotes([
    {
      id: 'a',
      author: 'Wine Advocate',
      kind: 'critic',
      score: null,
      noted_on: null,
      note: NOTE,
      source_url: 'https://a.com',
      source_site: 'a.com',
    },
    {
      id: 'b',
      author: 'William Kelley (Wine Advocate)',
      kind: 'critic',
      score: null,
      noted_on: '2022',
      note: NOTE,
      source_url: 'https://b.com',
      source_site: 'b.com',
    },
  ]);
  assert.deepEqual(
    shown.map((s) => s.id),
    ['b'],
  );
});

test('a note credited to the wrong page is moved to the page it is on; shops quoting Vinous are fine', () => {
  const pages = [
    {
      url: 'https://a.example.com/x',
      site: 'a.example.com',
      text: 'Nothing about tasting here at all. '.repeat(10),
      pdf: false,
    },
    { url: 'https://b.example.com/y', site: 'b.example.com', text: pageText(html), pdf: false },
  ];
  const { notes } = cleanNotes(
    {
      notes: [
        {
          vintage_id: V1,
          author: 'Neal Martin, vinous.com',
          kind: 'critic',
          score: '95',
          noted_on: null,
          note: NOTE,
          page: 1,
        },
      ],
    },
    wine,
    pages,
    2026,
  );
  assert.equal(notes.length, 1);
  assert.equal(notes[0].source_site, 'b.example.com');
  assert.equal(notes[0].author, 'Neal Martin, Vinous');
});
