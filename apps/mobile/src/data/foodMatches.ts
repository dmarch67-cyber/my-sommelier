import { supabase } from '../lib/supabase';

/**
 * Food matches for the Wine page: one list of dishes per wine, written by the
 * match-food Edge Function. The page reads the saved list; if a wine has none
 * yet it asks for that one wine. Separately, fillInFoodMatches() quietly works
 * through any wines still without dishes when the app starts.
 */

export type FoodMatch = {
  dishes: { dish: string; why: string }[];
  avoid: string | null;
  older: string | null;
};

type FillResult = { matched: number; remaining: number; matches?: FoodMatch[] };

/** The saved dishes for a wine, or null if none yet (or the table is not there yet). */
export async function loadFoodMatch(wineId: string): Promise<FoodMatch | null> {
  const { data, error } = await supabase
    .from('wine_food_matches')
    .select('dishes,avoid,older')
    .eq('wine_id', wineId)
    .maybeSingle();
  if (error || !data) return null;
  return data as FoodMatch;
}

/** Asks for one wine's dishes now. Null when the sommelier isn't available. */
export async function makeFoodMatch(wineId: string): Promise<FoodMatch | null> {
  const { data, error } = await supabase.functions.invoke<FillResult>('match-food', {
    body: { wine_id: wineId },
  });
  if (error || !data?.matches?.length) return null;
  return data.matches[0];
}

let running = false;

/** Fills in dishes for every wine still without them, a small batch per call. */
export async function fillInFoodMatches(keepGoing: () => boolean): Promise<void> {
  if (running) return;
  running = true;
  try {
    // A safety cap: 430 wines at 12 per call is about 36 calls.
    for (let round = 0; round < 60 && keepGoing(); round++) {
      const { data, error } = await supabase.functions.invoke<FillResult>('match-food', {
        body: {},
      });
      if (error || !data || data.matched === 0 || data.remaining === 0) break;
    }
  } catch {
    // Offline or not deployed yet: try again next start.
  } finally {
    running = false;
  }
}
