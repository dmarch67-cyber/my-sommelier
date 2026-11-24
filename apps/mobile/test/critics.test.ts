import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanAnswer,
  notesUrl,
  searchUrl,
  userText,
  type WineIn,
} from '../../../supabase/functions/critics-say/prompt.ts';

const wine: WineIn = {
  name: 'Château Lascombes',
  producer: 'Château Lascombes',
  place: 'Margaux, Bordeaux, France',
  vintages: [
    {
      vintage_id: 'v10',
      year: 2010,
      maturity: 'ready',
      recent_notes: 2,
      latest_note_year: 2025,
      summary: 'Recent notes agree the 2010 is drinking well now.',
      scores: [{ source: 'vinous', source_detail: 'CellarTracker export: AG', raw_value: '93' }],
    },
  ],
};

test('the prompt lists each vintage with its review and scores', () => {
  const text = userText(wine);
  assert.match(text, /vintage_id v10: 2010/);
  assert.match(text, /latest 2025/);
  assert.match(text, /AG 93/);
  assert.match(text, /drinking well now/);
});

test('answers keep only asked vintages, drop Vivino and em dashes', () => {
  const out = cleanAnswer(
    {
      vintages: [
        { vintage_id: 'v10', text: '  Silky cassis — drinking well now.  ' },
        { vintage_id: 'other', text: 'Not asked.' },
      ],
    },
    wine,
  );
  assert.deepEqual(out, [{ vintage_id: 'v10', text: 'Silky cassis, drinking well now.' }]);
  assert.deepEqual(
    cleanAnswer({ vintages: [{ vintage_id: 'v10', text: 'Vivino says 4.1' }] }, wine),
    [],
  );
  assert.deepEqual(cleanAnswer(null, wine), []);
});

test('links to the exact CellarTracker vintage page when the review read it', () => {
  const sources = [
    {
      url: 'https://www.cellartracker.com/wine.asp?iWine=111',
      title: '2009 Château Lascombes - CellarTracker',
    },
    {
      url: 'https://www.cellartracker.com/wine.asp?iWine=222',
      title: '2010 Chevalier de Lascombes - CellarTracker',
    },
    {
      url: 'https://www.cellartracker.com/wine.asp?iWine=333',
      title: '2010 Château Lascombes - CellarTracker',
    },
  ];
  assert.equal(
    notesUrl('Château Lascombes', 2010, sources),
    'https://www.cellartracker.com/wine.asp?iWine=333',
  );
});

test('falls back to a CellarTracker search', () => {
  assert.equal(notesUrl('Château Lascombes', 2011, []), searchUrl('Château Lascombes', 2011));
  assert.match(searchUrl('Krug Grande Cuvée', null), /szSearch=Krug%20Grande%20Cuv%C3%A9e$/);
});
