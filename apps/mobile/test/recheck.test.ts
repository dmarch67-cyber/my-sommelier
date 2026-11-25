import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanFindings,
  cleanWhy,
  costUsd,
  findingsText,
  NO_FETCH,
  RECHECK_NOTES_TOOL,
  RECHECK_SCHEMA,
  recheckReaderText,
} from '../../../supabase/functions/assess-wines/recheck.ts';

test('the recheck never opens CellarTracker, Vinous or WineBerserkers pages', () => {
  for (const site of ['cellartracker.com', 'vinous.com', 'wineberserkers.com']) {
    assert.ok(NO_FETCH.includes(site));
  }
});

test('findings are cleaned: bad windows dropped, empty items skipped, links checked', () => {
  const f = cleanFindings(
    {
      critics: [
        {
          critic: 'Wine Enthusiast',
          score: '94',
          drink_from: 2022,
          drink_to: 2034,
          date: '2019-04',
          gist: 'Lush, dark fruit.',
        },
        {
          critic: 'Someone',
          score: null,
          drink_from: 2030,
          drink_to: 2020,
          date: '',
          gist: 'Backwards window.',
        },
        { critic: '', score: null, drink_from: null, drink_to: null, date: '', gist: 'no name' },
        {
          critic: 'Old',
          score: null,
          drink_from: 2010,
          drink_to: 2012,
          date: '',
          gist: 'Before the vintage.',
        },
      ],
      notes: [
        { date: '2025-06', source: 'Blog', signal: 'nonsense', gist: 'Drinking well.' },
        { gist: '' },
      ],
      sources: [
        { url: 'https://example.com/x', title: 'X' },
        { url: 'javascript:alert(1)', title: 'bad' },
      ],
    },
    2016,
  );
  assert.equal(f.critics.length, 3);
  assert.deepEqual([f.critics[0].drink_from, f.critics[0].drink_to], [2022, 2034]);
  assert.deepEqual([f.critics[1].drink_from, f.critics[1].drink_to], [null, null]);
  assert.deepEqual([f.critics[2].drink_from, f.critics[2].drink_to], [null, null]);
  assert.equal(f.notes.length, 1);
  assert.equal(f.notes[0].signal, 'unclear');
  assert.equal(f.sources.length, 1);
  assert.match(findingsText(f), /Wine Enthusiast 94, window 2022-2034/);
  assert.match(findingsText(null), /nothing new found/);
});

test('the judge must say why', () => {
  const items = RECHECK_SCHEMA.properties.vintages.items as unknown as { required: string[] };
  assert.ok(items.required.includes('why'));
  assert.ok(items.required.includes('drink_from'));
  assert.equal(
    cleanWhy({ vintages: [{ vintage_id: 'v1', why: '  Because.  ' }] }, 'v1'),
    'Because.',
  );
  assert.equal(cleanWhy({ vintages: [{ vintage_id: 'v2', why: 'x' }] }, 'v1'), '');
  assert.equal(RECHECK_NOTES_TOOL.strict, true);
});

test('cost adds up the two models and the searches', () => {
  const c = costUsd({
    reader_input: 200_000,
    reader_output: 4_000,
    searches: 5,
    fetches: 3,
    judge_input: 3_000,
    judge_output: 2_000,
  });
  // reader 0.02 + 0.002, searches 0.05, judge 0.012 + 0.04 = 0.124
  assert.equal(c, 0.124);
});

test('the reader is told the exact bottling and vintage', () => {
  const t = recheckReaderText(
    {
      id: 'w',
      name: 'Daou Estate Cabernet',
      producer: 'Daou',
      country: 'USA',
      region: 'California',
      appellation: 'Paso Robles Adelaida District',
      colour: 'red',
      grapes: ['Cabernet Sauvignon'],
      vintages: [],
    },
    {
      id: 'v',
      year: 2016,
      bottles: 2,
      drink_from: 2020,
      drink_to: 2026,
      drink_window_source: 'blended',
      scores: [],
      own_notes: [],
    },
  );
  assert.match(t, /Daou Estate Cabernet/);
  assert.match(t, /Vintage: 2016/);
  assert.doesNotMatch(t, /2026/);
});
