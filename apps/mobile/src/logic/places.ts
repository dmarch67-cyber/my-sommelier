import { foldName } from './adding.ts';

/**
 * Where an appellation is: "Napa Valley" → California, USA; "Pauillac" →
 * Bordeaux, France. Used to fill in Region and Country on the Add bottles
 * form as soon as the appellation is typed. A built-in list covers the
 * common places; the account's own wines fill in anything else.
 */
export type Place = { subRegion: string | null; region: string; country: string };

/** [region, country, sub-region or null, appellations]. A sub-region name is itself an appellation too. */
type Group = [region: string, country: string, subRegion: string | null, appellations: string[]];

const GROUPS: Group[] = [
  // France: Bordeaux
  [
    'Bordeaux',
    'France',
    null,
    [
      'Bordeaux',
      'Bordeaux Supérieur',
      'Entre-Deux-Mers',
      'Côtes de Bourg',
      'Blaye',
      'Côtes de Castillon',
      'Castillon Côtes de Bordeaux',
      'Francs Côtes de Bordeaux',
    ],
  ],
  [
    'Bordeaux',
    'France',
    'Médoc',
    [
      'Médoc',
      'Haut-Médoc',
      'Pauillac',
      'Margaux',
      'Saint-Julien',
      'Saint-Estèphe',
      'Listrac-Médoc',
      'Listrac',
      'Moulis-en-Médoc',
      'Moulis',
    ],
  ],
  ['Bordeaux', 'France', 'Graves', ['Graves', 'Pessac-Léognan']],
  ['Bordeaux', 'France', 'Sauternais', ['Sauternes', 'Barsac']],
  [
    'Bordeaux',
    'France',
    'Libournais',
    [
      'Pomerol',
      'Lalande-de-Pomerol',
      'Saint-Émilion',
      'Saint-Émilion Grand Cru',
      'Fronsac',
      'Canon-Fronsac',
      'Montagne-Saint-Émilion',
      'Puisseguin-Saint-Émilion',
      'Lussac-Saint-Émilion',
      'Saint-Georges-Saint-Émilion',
    ],
  ],
  // France: Burgundy
  [
    'Burgundy',
    'France',
    null,
    ['Bourgogne', 'Bourgogne Hautes-Côtes de Nuits', 'Bourgogne Hautes-Côtes de Beaune'],
  ],
  [
    'Burgundy',
    'France',
    'Côte de Nuits',
    [
      'Côte de Nuits-Villages',
      'Marsannay',
      'Fixin',
      'Gevrey-Chambertin',
      'Chambertin',
      'Chambertin-Clos de Bèze',
      'Charmes-Chambertin',
      'Mazis-Chambertin',
      'Latricières-Chambertin',
      'Griotte-Chambertin',
      'Chapelle-Chambertin',
      'Ruchottes-Chambertin',
      'Morey-Saint-Denis',
      'Clos de la Roche',
      'Clos Saint-Denis',
      'Clos de Tart',
      'Clos des Lambrays',
      'Chambolle-Musigny',
      'Musigny',
      'Bonnes-Mares',
      'Vougeot',
      'Clos de Vougeot',
      'Vosne-Romanée',
      'Romanée-Conti',
      'La Tâche',
      'Richebourg',
      'Romanée-Saint-Vivant',
      'La Romanée',
      'La Grande Rue',
      'Échezeaux',
      'Grands-Échezeaux',
      'Flagey-Échezeaux',
      'Nuits-Saint-Georges',
    ],
  ],
  [
    'Burgundy',
    'France',
    'Côte de Beaune',
    [
      'Côte de Beaune-Villages',
      'Ladoix',
      'Aloxe-Corton',
      'Corton',
      'Corton-Charlemagne',
      'Pernand-Vergelesses',
      'Savigny-lès-Beaune',
      'Chorey-lès-Beaune',
      'Beaune',
      'Pommard',
      'Volnay',
      'Monthélie',
      'Auxey-Duresses',
      'Saint-Romain',
      'Meursault',
      'Puligny-Montrachet',
      'Chassagne-Montrachet',
      'Montrachet',
      'Bâtard-Montrachet',
      'Chevalier-Montrachet',
      'Bienvenues-Bâtard-Montrachet',
      'Criots-Bâtard-Montrachet',
      'Saint-Aubin',
      'Santenay',
      'Maranges',
    ],
  ],
  [
    'Burgundy',
    'France',
    'Côte Chalonnaise',
    ['Mercurey', 'Givry', 'Rully', 'Montagny', 'Bouzeron'],
  ],
  [
    'Burgundy',
    'France',
    'Mâconnais',
    ['Mâcon', 'Mâcon-Villages', 'Pouilly-Fuissé', 'Saint-Véran', 'Viré-Clessé'],
  ],
  [
    'Burgundy',
    'France',
    'Chablis',
    ['Chablis', 'Chablis Premier Cru', 'Chablis Grand Cru', 'Petit Chablis', 'Irancy'],
  ],
  [
    'Beaujolais',
    'France',
    null,
    [
      'Beaujolais',
      'Beaujolais-Villages',
      'Morgon',
      'Fleurie',
      'Moulin-à-Vent',
      'Brouilly',
      'Côte de Brouilly',
      'Chiroubles',
      'Chénas',
      'Juliénas',
      'Régnié',
      'Saint-Amour',
    ],
  ],
  // France: Rhône
  [
    'Rhône',
    'France',
    'Northern Rhône',
    [
      'Côte-Rôtie',
      'Condrieu',
      'Château-Grillet',
      'Saint-Joseph',
      'Crozes-Hermitage',
      'Hermitage',
      'Cornas',
      'Saint-Péray',
    ],
  ],
  [
    'Rhône',
    'France',
    'Southern Rhône',
    [
      'Châteauneuf-du-Pape',
      'Gigondas',
      'Vacqueyras',
      'Rasteau',
      'Lirac',
      'Tavel',
      'Vinsobres',
      'Cairanne',
      'Beaumes-de-Venise',
      'Ventoux',
      'Luberon',
    ],
  ],
  ['Rhône', 'France', null, ['Côtes du Rhône', 'Côtes du Rhône Villages']],
  [
    'Loire',
    'France',
    null,
    [
      'Sancerre',
      'Pouilly-Fumé',
      'Menetou-Salon',
      'Quincy',
      'Reuilly',
      'Vouvray',
      'Montlouis-sur-Loire',
      'Chinon',
      'Bourgueil',
      'Saint-Nicolas-de-Bourgueil',
      'Saumur',
      'Saumur-Champigny',
      'Savennières',
      'Anjou',
      'Coteaux du Layon',
      'Bonnezeaux',
      'Quarts de Chaume',
      'Muscadet',
      'Muscadet Sèvre et Maine',
    ],
  ],
  ['Champagne', 'France', null, ['Champagne', 'Coteaux Champenois', 'Rosé des Riceys']],
  ['Alsace', 'France', null, ['Alsace', 'Alsace Grand Cru', 'Crémant d’Alsace']],
  [
    'Provence',
    'France',
    null,
    [
      'Bandol',
      'Cassis',
      'Bellet',
      'Palette',
      'Côtes de Provence',
      'Coteaux d’Aix-en-Provence',
      'Les Baux-de-Provence',
    ],
  ],
  [
    'Languedoc-Roussillon',
    'France',
    null,
    [
      'Languedoc',
      'Pic Saint-Loup',
      'Terrasses du Larzac',
      'Faugères',
      'Saint-Chinian',
      'Minervois',
      'Corbières',
      'Fitou',
      'La Clape',
      'Limoux',
      'Collioure',
      'Banyuls',
      'Maury',
      'Côtes du Roussillon',
      'Côtes du Roussillon Villages',
    ],
  ],
  [
    'South West France',
    'France',
    null,
    ['Cahors', 'Madiran', 'Jurançon', 'Bergerac', 'Monbazillac', 'Gaillac', 'Irouléguy'],
  ],
  ['Jura', 'France', null, ['Arbois', 'Château-Chalon', 'Côtes du Jura', 'L’Étoile']],
  // USA: California
  [
    'California',
    'USA',
    'Napa Valley',
    [
      'Napa Valley',
      'Napa',
      'Oakville',
      'Rutherford',
      'St. Helena',
      'Saint Helena',
      'Stags Leap District',
      'Stag’s Leap District',
      'Stags Leap',
      'Howell Mountain',
      'Mount Veeder',
      'Spring Mountain District',
      'Spring Mountain',
      'Diamond Mountain District',
      'Diamond Mountain',
      'Atlas Peak',
      'Calistoga',
      'Yountville',
      'Coombsville',
      'Oak Knoll District',
      'Chiles Valley',
      'Wild Horse Valley',
      'Los Carneros',
      'Carneros',
    ],
  ],
  [
    'California',
    'USA',
    'Sonoma County',
    [
      'Sonoma',
      'Sonoma County',
      'Sonoma Coast',
      'Sonoma Valley',
      'Russian River Valley',
      'Russian River',
      'Alexander Valley',
      'Dry Creek Valley',
      'Knights Valley',
      'Chalk Hill',
      'Fort Ross-Seaview',
      'Moon Mountain District',
      'Petaluma Gap',
      'Green Valley',
      'Rockpile',
      'Bennett Valley',
      'Sonoma Mountain',
    ],
  ],
  [
    'California',
    'USA',
    'Mendocino',
    ['Mendocino', 'Anderson Valley', 'Lake County', 'Red Hills Lake County'],
  ],
  [
    'California',
    'USA',
    'Central Coast',
    [
      'Central Coast',
      'Santa Cruz',
      'Santa Cruz Mountains',
      'Monterey',
      'Santa Lucia Highlands',
      'Chalone',
      'Carmel Valley',
      'Arroyo Seco',
      'Paso Robles',
      'Paso',
      'Adelaida District',
      'Willow Creek District',
      'Templeton Gap District',
      'Edna Valley',
      'Arroyo Grande Valley',
      'San Luis Obispo',
      'Santa Maria',
      'Santa Maria Valley',
      'Santa Barbara',
      'Santa Barbara County',
      'Santa Rita Hills',
      'Sta. Rita Hills',
      'Santa Ynez Valley',
      'Ballard Canyon',
      'Happy Canyon',
      'Los Olivos District',
      'Livermore Valley',
    ],
  ],
  [
    'California',
    'USA',
    null,
    ['North Coast', 'Lodi', 'Sierra Foothills', 'Amador County', 'Temecula Valley'],
  ],
  // USA: Oregon, Washington, New York
  [
    'Oregon',
    'USA',
    'Willamette Valley',
    [
      'Willamette Valley',
      'Willamette',
      'Dundee Hills',
      'Eola-Amity Hills',
      'Yamhill-Carlton',
      'Yamhill-Carlton District',
      'Ribbon Ridge',
      'Chehalem Mountains',
      'McMinnville',
      'Van Duzer Corridor',
      'Tualatin Hills',
      'Laurelwood District',
      'Lower Long Tom',
      'Mount Pisgah',
    ],
  ],
  [
    'Oregon',
    'USA',
    'Southern Oregon',
    ['Southern Oregon', 'Rogue Valley', 'Applegate Valley', 'Umpqua Valley'],
  ],
  ['Oregon', 'USA', null, ['Columbia Gorge']],
  [
    'Washington',
    'USA',
    'Columbia Valley',
    [
      'Columbia Valley',
      'Walla Walla Valley',
      'Walla Walla',
      'Red Mountain',
      'Yakima Valley',
      'Horse Heaven Hills',
      'Wahluke Slope',
      'Rattlesnake Hills',
      'Royal Slope',
      'The Rocks District of Milton-Freewater',
    ],
  ],
  ['Washington', 'USA', null, ['Lake Chelan']],
  ['New York', 'USA', null, ['Finger Lakes', 'Long Island', 'North Fork of Long Island']],
  // Italy
  [
    'Piedmont',
    'Italy',
    'Langhe',
    [
      'Barolo',
      'Barbaresco',
      'Langhe',
      'Barbera d’Alba',
      'Dolcetto d’Alba',
      'Nebbiolo d’Alba',
      'Dogliani',
      'Roero',
    ],
  ],
  [
    'Piedmont',
    'Italy',
    'Alto Piemonte',
    ['Alto Piemonte', 'Gattinara', 'Ghemme', 'Boca', 'Lessona', 'Bramaterra'],
  ],
  [
    'Piedmont',
    'Italy',
    null,
    ['Barbera d’Asti', 'Nizza', 'Gavi', 'Moscato d’Asti', 'Asti', 'Carema'],
  ],
  [
    'Tuscany',
    'Italy',
    null,
    [
      'Chianti',
      'Chianti Classico',
      'Chianti Rufina',
      'Brunello di Montalcino',
      'Brunello',
      'Rosso di Montalcino',
      'Montalcino',
      'Vino Nobile di Montepulciano',
      'Montepulciano',
      'Bolgheri',
      'Bolgheri Sassicaia',
      'Toscana',
      'Maremma',
      'Morellino di Scansano',
      'Carmignano',
      'Vernaccia di San Gimignano',
      'Suvereto',
      'Val di Cornia',
    ],
  ],
  [
    'Veneto',
    'Italy',
    null,
    [
      'Amarone della Valpolicella',
      'Amarone',
      'Valpolicella',
      'Valpolicella Ripasso',
      'Recioto della Valpolicella',
      'Soave',
      'Prosecco',
      'Bardolino',
      'Lugana',
    ],
  ],
  ['Friuli', 'Italy', null, ['Collio', 'Friuli Colli Orientali', 'Friuli']],
  ['Trentino-Alto Adige', 'Italy', null, ['Alto Adige', 'Südtirol', 'Trentino', 'Trento']],
  [
    'Lombardy',
    'Italy',
    null,
    ['Franciacorta', 'Valtellina', 'Valtellina Superiore', 'Sforzato di Valtellina'],
  ],
  ['Campania', 'Italy', null, ['Taurasi', 'Fiano di Avellino', 'Greco di Tufo']],
  [
    'Sicily',
    'Italy',
    null,
    ['Etna', 'Etna Rosso', 'Etna Bianco', 'Cerasuolo di Vittoria', 'Marsala'],
  ],
  ['Abruzzo', 'Italy', null, ['Montepulciano d’Abruzzo', 'Trebbiano d’Abruzzo']],
  ['Umbria', 'Italy', null, ['Montefalco', 'Montefalco Sagrantino', 'Orvieto']],
  ['Basilicata', 'Italy', null, ['Aglianico del Vulture']],
  // Spain
  ['Rioja', 'Spain', null, ['Rioja', 'Rioja Alta', 'Rioja Alavesa', 'Rioja Oriental']],
  [
    'Castilla y León',
    'Spain',
    null,
    [
      'Ribera del Duero',
      'Ribera',
      'Toro',
      'Rueda',
      'Bierzo',
      'Cigales',
      'Sardón de Duero',
      'Arribes',
      'Tierra de León',
    ],
  ],
  [
    'Catalonia',
    'Spain',
    null,
    [
      'Priorat',
      'Montsant',
      'Penedès',
      'Cava',
      'Terra Alta',
      'Empordà',
      'Costers del Segre',
      'Conca de Barberà',
    ],
  ],
  ['Aragón', 'Spain', null, ['Campo de Borja', 'Calatayud', 'Cariñena', 'Somontano']],
  ['Murcia', 'Spain', null, ['Jumilla', 'Yecla', 'Bullas']],
  ['Galicia', 'Spain', null, ['Rías Baixas', 'Ribeira Sacra', 'Valdeorras', 'Ribeiro']],
  [
    'Andalusia',
    'Spain',
    null,
    ['Jerez', 'Sherry', 'Manzanilla-Sanlúcar de Barrameda', 'Montilla-Moriles', 'Málaga'],
  ],
  ['Navarra', 'Spain', null, ['Navarra']],
  ['Madrid', 'Spain', null, ['Vinos de Madrid']],
  ['Valencia', 'Spain', null, ['Alicante', 'Utiel-Requena']],
  // Portugal
  ['Douro', 'Portugal', null, ['Douro', 'Port', 'Porto']],
  ['Alentejo', 'Portugal', null, ['Alentejo']],
  ['Dão', 'Portugal', null, ['Dão']],
  ['Vinho Verde', 'Portugal', null, ['Vinho Verde']],
  ['Madeira', 'Portugal', null, ['Madeira']],
  ['Bairrada', 'Portugal', null, ['Bairrada']],
  // Germany and Austria
  ['Mosel', 'Germany', null, ['Mosel', 'Saar', 'Ruwer']],
  ['Rheingau', 'Germany', null, ['Rheingau']],
  ['Pfalz', 'Germany', null, ['Pfalz']],
  ['Nahe', 'Germany', null, ['Nahe']],
  ['Rheinhessen', 'Germany', null, ['Rheinhessen']],
  ['Franken', 'Germany', null, ['Franken']],
  ['Baden', 'Germany', null, ['Baden']],
  [
    'Niederösterreich',
    'Austria',
    null,
    ['Wachau', 'Kamptal', 'Kremstal', 'Wagram', 'Traisental', 'Weinviertel'],
  ],
  ['Burgenland', 'Austria', null, ['Mittelburgenland', 'Neusiedlersee', 'Leithaberg']],
  ['Steiermark', 'Austria', null, ['Südsteiermark']],
  // Southern hemisphere
  ['South Australia', 'Australia', 'Barossa', ['Barossa Valley', 'Barossa', 'Eden Valley']],
  [
    'South Australia',
    'Australia',
    null,
    [
      'McLaren Vale',
      'Clare Valley',
      'Coonawarra',
      'Adelaide Hills',
      'Langhorne Creek',
      'Wrattonbully',
    ],
  ],
  [
    'Victoria',
    'Australia',
    null,
    [
      'Yarra Valley',
      'Mornington Peninsula',
      'Heathcote',
      'Rutherglen',
      'Geelong',
      'Grampians',
      'Beechworth',
    ],
  ],
  ['New South Wales', 'Australia', null, ['Hunter Valley', 'Orange', 'Mudgee']],
  ['Western Australia', 'Australia', null, ['Margaret River', 'Great Southern', 'Frankland River']],
  ['Tasmania', 'Australia', null, []],
  ['Marlborough', 'New Zealand', null, ['Awatere Valley']],
  ['Central Otago', 'New Zealand', null, []],
  ['Hawke’s Bay', 'New Zealand', null, ['Gimblett Gravels']],
  ['Wairarapa', 'New Zealand', null, ['Martinborough']],
  ['Mendoza', 'Argentina', null, ['Luján de Cuyo', 'Uco Valley', 'Valle de Uco', 'Maipú']],
  ['Salta', 'Argentina', null, ['Cafayate']],
  [
    'Central Valley',
    'Chile',
    null,
    ['Maipo Valley', 'Colchagua Valley', 'Cachapoal Valley', 'Rapel Valley', 'Maule Valley'],
  ],
  [
    'Aconcagua',
    'Chile',
    null,
    ['Aconcagua Valley', 'Casablanca Valley', 'San Antonio Valley', 'Leyda Valley'],
  ],
  [
    'Western Cape',
    'South Africa',
    null,
    [
      'Stellenbosch',
      'Swartland',
      'Franschhoek',
      'Paarl',
      'Constantia',
      'Elgin',
      'Hemel-en-Aarde',
      'Walker Bay',
    ],
  ],
];

const COUNTRIES = new Set(
  [
    ...GROUPS.map((g) => g[1]),
    'United States',
    'Greece',
    'Hungary',
    'Lebanon',
    'Israel',
    'Canada',
    'Switzerland',
    'Slovenia',
    'Croatia',
    'Georgia',
    'Uruguay',
  ].map(foldName),
);

const BUILT_IN = new Map<string, Place>();
function put(name: string, place: Place) {
  const k = foldName(name);
  if (k && !BUILT_IN.has(k)) BUILT_IN.set(k, place);
}
for (const [region, country, subRegion, names] of GROUPS) {
  for (const n of names) put(n, { subRegion, region, country });
  if (subRegion) put(subRegion, { subRegion, region, country });
}
// Region names on their own ("California", "Bordeaux", "Piemonte").
for (const [region, country] of GROUPS) put(region, { subRegion: null, region, country });
for (const [alias, region, country] of [
  ['Rhone Valley', 'Rhône', 'France'],
  ['Loire Valley', 'Loire', 'France'],
  ['Roussillon', 'Languedoc-Roussillon', 'France'],
  ['Piemonte', 'Piedmont', 'Italy'],
  ['Toscana', 'Tuscany', 'Italy'],
  ['Catalunya', 'Catalonia', 'Spain'],
  ['Burgundy', 'Burgundy', 'France'],
  ['Bourgogne', 'Burgundy', 'France'],
] as const) {
  put(alias, { subRegion: null, region, country });
}

/** True when the text is a country name, not a region typed in the wrong box. */
export function isCountry(text: string): boolean {
  return COUNTRIES.has(foldName(text));
}

/**
 * Learn appellation → place from wines already in the cellar, so places Dan
 * has bought before fill in even when the built-in list misses them. Skips
 * rows where a region was typed as the country.
 */
export function learnPlaces(
  rows: {
    appellation: string | null;
    sub_region?: string | null;
    region: string | null;
    country: string | null;
  }[],
): Map<string, Place> {
  const counts = new Map<string, Map<string, { place: Place; n: number }>>();
  for (const r of rows) {
    if (!r.appellation || !r.region || !r.country || !isCountry(r.country)) continue;
    const key = foldName(r.appellation);
    if (!key) continue;
    const inner = counts.get(key) ?? new Map<string, { place: Place; n: number }>();
    const pk = `${r.sub_region ?? ''}|${r.region}|${r.country}`;
    const hit = inner.get(pk) ?? {
      place: { subRegion: r.sub_region ?? null, region: r.region, country: r.country },
      n: 0,
    };
    hit.n += 1;
    inner.set(pk, hit);
    counts.set(key, inner);
  }
  const out = new Map<string, Place>();
  for (const [key, inner] of counts) {
    out.set(key, [...inner.values()].sort((a, b) => b.n - a.n)[0].place);
  }
  return out;
}

/**
 * Where a place name sits: an appellation ("Oakville"), a sub-region
 * ("Napa Valley") or a region ("Bordeaux"). Accent and case blind, and
 * "St" = "Saint". Extra words after the name are ignored ("Pauillac 1er Cru").
 */
export function lookupPlace(text: string, learned?: Map<string, Place>): Place | null {
  const key = foldName(text);
  if (key.length < 3) return null;
  const words = key.split(' ');
  for (let n = words.length; n >= 1; n--) {
    const k = words.slice(0, n).join(' ');
    const hit = BUILT_IN.get(k) ?? learned?.get(k);
    if (hit) return hit;
  }
  return null;
}

/** The place boxes on the Add form. */
export type PlaceFields = { subRegion: string; region: string; country: string };

/**
 * Fill the place boxes from what was looked up. A box is only changed when
 * it is empty or still holds what was filled in automatically last time, so
 * anything typed by hand is kept. Returns the new boxes and what was filled.
 */
export function autoFill(
  current: PlaceFields,
  lastAuto: PlaceFields,
  place: Place | null,
  skip: (keyof PlaceFields)[] = [],
): { fields: PlaceFields; auto: PlaceFields } {
  const fields = { ...current };
  const auto = { ...lastAuto };
  for (const k of ['subRegion', 'region', 'country'] as const) {
    if (skip.includes(k)) continue;
    const mine = current[k].trim() !== '' && current[k] !== lastAuto[k];
    if (mine) continue;
    const v = (place?.[k] as string | null | undefined) ?? '';
    fields[k] = v;
    auto[k] = v;
  }
  return { fields, auto };
}

/**
 * A place typed into the wrong box, fixed when you leave it: "Napa Valley" as
 * a region becomes sub-region Napa Valley in California; "California" as a
 * country becomes region California, USA. Returns null when it looks right.
 */
export function tidyPlace(
  box: keyof PlaceFields,
  current: PlaceFields,
  learned?: Map<string, Place>,
): PlaceFields | null {
  const typed = current[box].trim();
  if (!typed) return null;
  const hit = lookupPlace(typed, learned);
  if (!hit) return null;
  const same = (a: string | null) => !!a && foldName(a) === foldName(typed);
  const next = { ...current };
  if (box === 'country') {
    if (isCountry(typed)) return null;
    next.country = hit.country;
    if (same(hit.region)) next.region = next.region || hit.region;
    else if (same(hit.subRegion)) {
      next.subRegion = next.subRegion || hit.subRegion!;
      next.region = next.region || hit.region;
    } else return null;
  } else if (box === 'region') {
    if (same(hit.region)) {
      if (!next.country) next.country = hit.country;
    } else if (same(hit.subRegion)) {
      next.subRegion = hit.subRegion!;
      next.region = hit.region;
      if (!next.country) next.country = hit.country;
    } else return null;
  } else {
    // Sub-region box: "California" typed there is a region.
    if (same(hit.region) && !hit.subRegion) {
      next.subRegion = '';
      next.region = hit.region;
      if (!next.country) next.country = hit.country;
    } else if (same(hit.subRegion)) {
      if (!next.region) next.region = hit.region;
      if (!next.country) next.country = hit.country;
    } else return null;
  }
  return JSON.stringify(next) === JSON.stringify(current) ? null : next;
}
