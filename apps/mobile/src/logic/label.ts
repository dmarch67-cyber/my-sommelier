import type { KnownWine, LabelReading } from '../../../../supabase/functions/read-label/prompt.ts';
import type { InventoryRow } from './cellar.ts';
import { exactWine } from './adding.ts';

export type { KnownWine, LabelReading };

/** Every wine in the account once, with where it's from, for the label reader to match against. */
export function knownWines(rows: InventoryRow[]): KnownWine[] {
  const seen = new Map<string, KnownWine>();
  for (const r of rows) {
    if (seen.has(r.wine_id)) continue;
    seen.set(r.wine_id, {
      id: r.wine_id,
      name: r.wine_name,
      place: [r.appellation, r.region, r.country].filter(Boolean).join(', '),
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The wine in the cellar a reading points to: the reader's own match, or else
 * a wine whose name is the same once accents and "Château" are ignored.
 */
export function matchedWineId(reading: LabelReading, rows: InventoryRow[]): string | null {
  if (reading.match_wine_id && rows.some((r) => r.wine_id === reading.match_wine_id))
    return reading.match_wine_id;
  if (!reading.wine_name) return null;
  return exactWine(rows, reading.wine_name)?.wine_id ?? null;
}

/** "Santa Cruz Mountains, California, USA" */
export function readingPlace(reading: LabelReading): string {
  return [reading.appellation, reading.region, reading.country].filter(Boolean).join(', ');
}

/** What to hand to the "Type it or say it" screen so Dan only checks and taps Add. */
export function addParams(reading: LabelReading, wineId: string | null): Record<string, string> {
  const p: Record<string, string> = { from: 'label' };
  if (wineId) p.wineId = wineId;
  else {
    p.name = reading.wine_name ?? '';
    if (reading.country) p.country = reading.country;
    if (reading.region) p.region = reading.region;
    if (reading.appellation) p.appellation = reading.appellation;
  }
  p.vintage = reading.vintage ? String(reading.vintage) : 'NV';
  if (reading.bottle_size_ml) p.size = String(reading.bottle_size_ml);
  return p;
}
