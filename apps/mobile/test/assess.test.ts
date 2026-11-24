import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanAssessment,
  RECORD_TOOL,
  systemPrompt,
  userText,
  type WineIn,
} from '../../../supabase/functions/assess-wines/prompt.ts';

const wine: WineIn = {
  id: 'w1',
  name: 'Ridge Monte Bello',
  producer: 'Ridge',
  country: 'USA',
  region: 'California',
  appellation: 'Santa Cruz Mountains',
  colour: 'red',
  grapes: ['Cabernet Sauvignon'],
  vintages: [
    {
      id: 'v19',
      year: 2019,
      bottles: 6,
      drink_from: 2030,
      drink_to: 2060,
      drink_window_source: 'cellartracker',
      scores: [
        {
          source: 'vinous',
          source_detail: 'CellarTracker export: Vinous (Antonio Galloni)',
          raw_value: '98',
          drink_from: null,
          drink_to: null,
          reviewed_on: null,
        },
      ],
      own_notes: [],
    },
    {
      id: 'v05',
      year: 2005,
      bottles: 1,
      drink_from: null,
      drink_to: null,
      drink_window_source: null,
      scores: [],
      own_notes: [{ tasted_on: '2026-10-01', maturity: 'declining', rating: 90, notes: 'Fading' }],
    },
  ],
};

test('the prompt gives each vintage with its evidence', () => {
  const text = userText(wine);
  assert.match(text, /Wine: Ridge Monte Bello/);
  assert.match(text, /vintage_id v19: 2019 \(6 bottles\)/);
  assert.match(text, /CellarTracker window: 2030-2060/);
  assert.match(text, /score: Vinous \(Antonio Galloni\) 98/);
  assert.match(text, /owner's note: 2026-10-01 · declining · 90 pts · Fading/);
  assert.match(systemPrompt(2026), /It is 2026/);
});

test('the record tool is strict and asks for every field', () => {
  assert.equal(RECORD_TOOL.strict, true);
  const item = RECORD_TOOL.input_schema.properties.vintages.items;
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
});

test('answers are checked before saving', () => {
  const clean = cleanAssessment(
    {
      vintages: [
        {
          vintage_id: 'v19',
          drink_from: 2029,
          drink_to: 2052,
          maturity: 'too_young',
          confidence: 'high',
          summary: '  Tight.  ',
          recent_notes: 5,
          latest_note_year: 2026,
        },
        { vintage_id: 'v19', drink_from: 2000, drink_to: 2001 },
        {
          vintage_id: 'v05',
          drink_from: 2030,
          drink_to: 2020,
          maturity: 'gone',
          confidence: 'sure',
          summary: 3,
          recent_notes: -2,
          latest_note_year: 2099,
        },
        { vintage_id: 'nope', drink_from: 2020, drink_to: 2030 },
      ],
      sources: [{ url: 'https://example.test/a', title: 'A' }, { url: 'javascript:alert(1)' }],
    },
    wine,
    2026,
  );
  assert.equal(clean.vintages.length, 2);
  assert.deepEqual(clean.vintages[0], {
    vintage_id: 'v19',
    drink_from: 2029,
    drink_to: 2052,
    maturity: 'too_young',
    confidence: 'high',
    summary: 'Tight.',
    recent_notes: 5,
    latest_note_year: 2026,
  });
  const v05 = clean.vintages[1];
  assert.equal(v05.drink_from, null, 'backwards window dropped');
  assert.equal(v05.maturity, null);
  assert.equal(v05.confidence, 'low');
  assert.equal(v05.recent_notes, 0);
  assert.equal(v05.latest_note_year, null);
  assert.deepEqual(clean.sources, [{ url: 'https://example.test/a', title: 'A' }]);
});

test('a window may not start before the vintage', () => {
  const clean = cleanAssessment(
    { vintages: [{ vintage_id: 'v19', drink_from: 2015, drink_to: 2040 }], sources: [] },
    wine,
    2026,
  );
  assert.equal(clean.vintages[0].drink_from, null);
});
