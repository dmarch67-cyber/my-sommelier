import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  litresToMl,
  lookupPlace,
  parseAccolade,
  parseCount,
  parsePrice,
  parseScore,
  splitSizeFromName,
  titleCase,
  wineMatchKey,
} from '../src/normalise.ts';

test('trims and collapses whitespace', () => {
  assert.equal(cleanText('  AALTO  PS  '), 'AALTO PS');
});

test('splits a 1.5L marker out of the name', () => {
  assert.deepEqual(splitSizeFromName('SAXUM BONE ROCK 1.5L'), {
    name: 'SAXUM BONE ROCK',
    sizeMl: 1500,
  });
  assert.deepEqual(splitSizeFromName('SAXUM BONE ROCK'), { name: 'SAXUM BONE ROCK', sizeMl: null });
  assert.equal(litresToMl(0.75), 750);
  assert.equal(litresToMl(1.5), 1500);
  assert.equal(litresToMl(' '), null);
});

test('title-cases names for display', () => {
  assert.equal(titleCase("CLOS L'ORATOIRE"), "Clos L'Oratoire");
  assert.equal(titleCase("D'ISSAN"), "D'Issan");
  assert.equal(titleCase('GRAND-PUY-LACOSTE'), 'Grand-Puy-Lacoste');
  assert.equal(titleCase('DOMAINE DE CHEVALIER'), 'Domaine de Chevalier');
  assert.equal(titleCase('CHÂTEAUNEUF-DU-PAPE'), 'Châteauneuf-du-Pape');
  assert.equal(titleCase('AALTO PS'), 'Aalto PS');
  assert.equal(titleCase('00 VGW CHARDONNAY'), '00 VGW Chardonnay');
});

test('matches the same wine with or without Château, accents and hyphens', () => {
  const k = wineMatchKey('BARDE-HAUT', 'France');
  assert.equal(wineMatchKey('CHATEAU BARDE-HAUT', 'France'), k);
  assert.equal(wineMatchKey('CHÂTEAU BARDE HAUT', 'France'), k);
  assert.notEqual(wineMatchKey('BARDE-HAUT', 'Spain'), k);
  assert.equal(wineMatchKey('PHELAN SEGUR', 'France'), wineMatchKey('PHELAN-SEGUR', 'France'));
});

test('folds region spellings', () => {
  for (const s of ['ST. JULIEN', 'ST JULIEN', 'St Julien'])
    assert.equal(lookupPlace(s)?.appellation, 'Saint-Julien');
  assert.equal(lookupPlace('PAULLIAC')?.appellation, 'Pauillac');
  assert.equal(lookupPlace('SARDON DEL DEUERO')?.appellation, 'Sardón de Duero');
  assert.equal(
    lookupPlace('YAMHILL CARLTON')?.appellation,
    lookupPlace('YAMHILL-CARLTON')?.appellation,
  );
  assert.equal(lookupPlace('WALLA WALLA')?.region, 'Washington');
  assert.equal(lookupPlace('NOWHERE'), undefined);
});

test('parses scores and keeps the text', () => {
  assert.deepEqual(parseScore(94), {
    raw: '94',
    low: 94,
    high: null,
    plus: false,
    barrel: false,
    parsed: true,
  });
  assert.deepEqual(parseScore('94+'), {
    raw: '94+',
    low: 94,
    high: null,
    plus: true,
    barrel: false,
    parsed: true,
  });
  assert.deepEqual(parseScore('92-94'), {
    raw: '92-94',
    low: 92,
    high: 94,
    plus: false,
    barrel: true,
    parsed: true,
  });
  assert.equal(parseScore(null), null);
  assert.equal(parseScore(' '), null);
  assert.equal(parseScore('great')?.parsed, false);
});

test('parses accolades', () => {
  assert.deepEqual(parseAccolade('WS #2 WOY 2018'), {
    raw: 'WS #2 WOY 2018',
    publication: 'Wine Spectator',
    title: 'Wine of the Year',
    rank: 2,
    year: 2018,
  });
  assert.equal(parseAccolade('VINOUS #37 WOY 2025')?.publication, 'Vinous');
  assert.equal(parseAccolade('something else')?.publication, null);
});

test('treats price 0 and blank as unknown', () => {
  assert.equal(parsePrice(0), null);
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(' '), null);
  assert.equal(parsePrice(28.666666), 28.67);
});

test('reads counts, with blanks and stray spaces as 0', () => {
  assert.deepEqual(parseCount(' '), { value: 0, ok: true });
  assert.deepEqual(parseCount(null), { value: 0, ok: true });
  assert.deepEqual(parseCount(4), { value: 4, ok: true });
  assert.equal(parseCount(1.5).ok, false);
  assert.equal(parseCount(-1).ok, false);
});
