import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeLine } from '../src/logic/cellar.ts';
import { autoFill, learnPlaces, lookupPlace, tidyPlace } from '../src/logic/places.ts';

const EMPTY = { subRegion: '', region: '', country: '' };

test('appellations know their sub-region, region and country', () => {
  assert.deepEqual(lookupPlace('Oakville'), {
    subRegion: 'Napa Valley',
    region: 'California',
    country: 'USA',
  });
  assert.deepEqual(lookupPlace('Napa Valley'), {
    subRegion: 'Napa Valley',
    region: 'California',
    country: 'USA',
  });
  assert.deepEqual(lookupPlace('st estephe'), {
    subRegion: 'Médoc',
    region: 'Bordeaux',
    country: 'France',
  });
  assert.deepEqual(lookupPlace('Saint-Émilion Grand Cru'), {
    subRegion: 'Libournais',
    region: 'Bordeaux',
    country: 'France',
  });
  assert.deepEqual(lookupPlace('Dundee Hills'), {
    subRegion: 'Willamette Valley',
    region: 'Oregon',
    country: 'USA',
  });
  assert.deepEqual(lookupPlace('Barolo'), {
    subRegion: 'Langhe',
    region: 'Piedmont',
    country: 'Italy',
  });
  assert.equal(lookupPlace('Bordeaux')?.country, 'France');
  assert.equal(lookupPlace('Pauillac 1er Cru')?.region, 'Bordeaux');
  assert.equal(lookupPlace('Gevrey Chambertin')?.subRegion, 'Côte de Nuits');
  assert.equal(lookupPlace('Nowhere Special'), null);
  assert.equal(lookupPlace('Na'), null);
});

test('places learned from the cellar fill gaps, ignoring a region typed as country', () => {
  const learned = learnPlaces([
    { appellation: 'Arroyo Secret', region: 'Madrid', country: 'Spain' },
    { appellation: 'Odd Place', region: null, country: 'California' },
  ]);
  assert.deepEqual(lookupPlace('Arroyo Secret', learned), {
    subRegion: null,
    region: 'Madrid',
    country: 'Spain',
  });
  assert.equal(lookupPlace('Odd Place', learned), null);
});

test('auto-fill replaces its own guesses but keeps what was typed', () => {
  let r = autoFill(EMPTY, EMPTY, lookupPlace('Napa'));
  assert.deepEqual(r.fields, { subRegion: 'Napa Valley', region: 'California', country: 'USA' });
  // Keeps typing: "Napa Valley" then switches to Pauillac.
  r = autoFill(r.fields, r.auto, lookupPlace('Pauillac'));
  assert.deepEqual(r.fields, { subRegion: 'Médoc', region: 'Bordeaux', country: 'France' });
  // Unknown appellation clears the guesses.
  r = autoFill(r.fields, r.auto, lookupPlace('Somewhere'));
  assert.deepEqual(r.fields, EMPTY);
  // A country typed by hand is kept.
  r = autoFill({ ...EMPTY, country: 'Francia' }, EMPTY, lookupPlace('Margaux'));
  assert.deepEqual(r.fields, { subRegion: 'Médoc', region: 'Bordeaux', country: 'Francia' });
});

test('a place typed in the wrong box is tidied on leaving it', () => {
  assert.deepEqual(tidyPlace('region', { ...EMPTY, region: 'Napa Valley' }), {
    subRegion: 'Napa Valley',
    region: 'California',
    country: 'USA',
  });
  assert.deepEqual(tidyPlace('country', { ...EMPTY, country: 'California' }), {
    subRegion: '',
    region: 'California',
    country: 'USA',
  });
  assert.deepEqual(tidyPlace('region', { ...EMPTY, region: 'Bordeaux' }), {
    subRegion: '',
    region: 'Bordeaux',
    country: 'France',
  });
  assert.equal(tidyPlace('country', { ...EMPTY, country: 'France' }), null);
  assert.equal(tidyPlace('region', { subRegion: '', region: 'Bordeaux', country: 'France' }), null);
});

test('place line shows sub-region once', () => {
  assert.equal(
    placeLine({
      appellation: 'Oakville',
      subRegion: 'Napa Valley',
      region: 'California',
      country: 'USA',
    }),
    'Oakville, Napa Valley, California, USA',
  );
  assert.equal(
    placeLine({
      appellation: 'Napa Valley',
      subRegion: 'Napa Valley',
      region: 'California',
      country: 'USA',
    }),
    'Napa Valley, California, USA',
  );
});
