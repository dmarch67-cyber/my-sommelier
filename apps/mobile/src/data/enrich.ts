import { supabase } from '../lib/supabase';
import { fillInFoodMatches } from './foodMatches';

/**
 * First brings in facts from the owner's CellarTracker account (at most once
 * a day; the function decides), then quietly asks the enrich-wines Edge Function to fill in missing wine facts,
 * one small batch at a time, until none are left. Nothing is shown to the
 * user: screens simply pick up colours, body, grapes and windows as they
 * arrive. Problems (no key, no credit, offline) just stop the run; it tries
 * again next time the app starts.
 */

let running = false;

type Result = { enriched: number; windows: number; remaining: number };

export async function fillInWines(
  keepGoing: () => boolean,
  refresh: () => Promise<void>,
): Promise<void> {
  if (running) return;
  running = true;
  let changed = 0;
  try {
    const ct = await supabase.functions
      .invoke<{ matched?: number }>('sync-cellartracker', { body: {} })
      .catch(() => null);
    if (ct?.data?.matched) await refresh();

    // A safety cap: 427 wines at 15 per call is about 29 calls.
    for (let round = 0; round < 80 && keepGoing(); round++) {
      const { data, error } = await supabase.functions.invoke<Result>('enrich-wines', {
        body: {},
      });
      if (error || !data) break;
      changed += data.enriched;
      // Refresh every few batches so screens fill in as we go.
      if (data.enriched > 0 && (round % 4 === 3 || data.remaining === 0)) {
        await refresh();
        changed = 0;
      }
      if (data.remaining === 0 || data.enriched === 0) break;
    }
  } catch {
    // Offline or the function is not deployed yet: try again next start.
  } finally {
    if (changed > 0) await refresh().catch(() => undefined);
    running = false;
  }
  // Then dishes for the Wine page, once grapes and style are known.
  if (keepGoing()) await fillInFoodMatches(keepGoing);
}
