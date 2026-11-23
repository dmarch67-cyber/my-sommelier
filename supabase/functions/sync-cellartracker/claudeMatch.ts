// Second pass of CellarTracker matching: Claude matches the names the simple
// word comparison could not (e.g. "Aalto 2005" in the app is "Bodegas AAlto
// Ribera del Duero AAlto 2005" in CellarTracker).
// Plain TypeScript with no Deno or Node APIs, so the app's tests can import it too.

import { ctYear, type AppVintage } from './ct.ts';

export const MODEL = 'claude-opus-5-5';

export type Leftovers = {
  /** App vintages still unmatched that have at least one same-year candidate. */
  apps: AppVintage[];
  /** Unused CellarTracker rows, by year key ("2019", or "null" for non-vintage). */
  candidates: Map<string, Record<string, string>[]>;
};

const yearKey = (y: number | null) => String(y);

export function leftovers(
  rows: Record<string, string>[],
  vintages: AppVintage[],
  matchedVintageIds: Set<string>,
  usedIWines: Set<string>,
): Leftovers {
  const candidates = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    if (!r.iWine || usedIWines.has(r.iWine)) continue;
    const key = yearKey(ctYear(r.Vintage ?? ''));
    candidates.set(key, [...(candidates.get(key) ?? []), r]);
  }
  const apps = vintages.filter(
    (v) => !matchedVintageIds.has(v.vintage_id) && candidates.has(yearKey(v.year)),
  );
  return { apps, candidates };
}

export const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['vintage_id', 'ct_id'],
        properties: {
          vintage_id: { type: 'string' },
          ct_id: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

export const SYSTEM = `You match wines in a private cellar app to the same wines in the owner's CellarTracker list. App names are the owner's shorthand from a spreadsheet ("Aalto PS", "Leoville Barton", "Penfolds Rwt Bin 798"). CellarTracker names are full ("Bodegas AAlto Ribera del Duero P.S.", "Château Léoville Barton", "Penfolds RWT Bin 798 Shiraz").

For each app wine, pick the CellarTracker id of the same wine: same producer and same cuvée, from the candidates listed under the same vintage. A different cuvée from the same producer is NOT a match (Saxum Bone Rock is not Saxum James Berry; Aalto is not Aalto P.S.; a second wine is not the grand vin). If no candidate is clearly the same wine, answer null. When unsure, answer null: a wrong match is worse than none. Each CellarTracker id may be used at most once.`;

export function pickPrompt(l: Leftovers): string {
  const years = [...new Set(l.apps.map((a) => yearKey(a.year)))].sort();
  const parts = years.map((y) => {
    const apps = l.apps
      .filter((a) => yearKey(a.year) === y)
      .map((a) => `  app ${a.vintage_id} | ${a.wine_name}`);
    const cands = (l.candidates.get(y) ?? []).map(
      (r) => `  ct ${r.iWine} | ${r.Wine}${r.Appellation ? ` (${r.Appellation})` : ''}`,
    );
    return `Vintage ${y === 'null' ? 'NV' : y}\n App wines:\n${apps.join('\n')}\n CellarTracker candidates:\n${cands.join('\n')}`;
  });
  return parts.join('\n\n');
}

/** Checks Claude's picks: right year, a real candidate, each CellarTracker wine used once. */
export function cleanPicks(raw: unknown, l: Leftovers): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const picks =
    raw && typeof raw === 'object' && Array.isArray((raw as { picks?: unknown }).picks)
      ? ((raw as { picks: unknown[] }).picks as Record<string, unknown>[])
      : [];
  const apps = new Map(l.apps.map((a) => [a.vintage_id, a]));
  const taken = new Set<string>();
  for (const p of picks) {
    if (!p || typeof p.vintage_id !== 'string' || typeof p.ct_id !== 'string') continue;
    const app = apps.get(p.vintage_id);
    if (!app || out.has(app.vintage_id) || taken.has(p.ct_id)) continue;
    const row = (l.candidates.get(yearKey(app.year)) ?? []).find((r) => r.iWine === p.ct_id);
    if (!row) continue;
    taken.add(p.ct_id);
    out.set(app.vintage_id, row);
  }
  return out;
}
