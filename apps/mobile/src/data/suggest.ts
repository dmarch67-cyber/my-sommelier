import { FunctionsHttpError } from '@supabase/supabase-js';

import type { Candidate, Suggestion } from '../../../../supabase/functions/suggest-wines/prompt.ts';
import { supabase } from '../lib/supabase';

export type { Candidate, Suggestion };

export class SuggestError extends Error {
  constructor(
    message: string,
    /** True when the sommelier is simply not switched on yet: the screen stays quiet. */
    readonly unavailable = false,
  ) {
    super(message);
  }
}

/** Asks the sommelier (a Supabase Edge Function that asks Claude) to choose from these bottles. */
export async function askSommelier(
  ask: string,
  candidates: Candidate[],
  /** The owner's palate in a few sentences (logic/palate.ts palateText). */
  palate?: string,
): Promise<Suggestion> {
  const { data, error } = await supabase.functions.invoke<Suggestion>('suggest-wines', {
    body: { ask, candidates, ...(palate ? { palate } : {}) },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      let body: { error?: string; code?: string } = {};
      try {
        body = await res.json();
      } catch {
        // not JSON
      }
      const unavailable = res.status === 404 || body.code === 'no_key';
      throw new SuggestError(body.error ?? 'The sommelier isn’t available right now.', unavailable);
    }
    throw new SuggestError('No connection. Check the internet and try again.');
  }
  if (!data || !Array.isArray(data.picks)) {
    throw new SuggestError('The sommelier gave an unclear answer. Try again.');
  }
  return { picks: data.picks, note: data.note ?? null };
}
