import { FunctionsHttpError } from '@supabase/supabase-js';

import type { Answer, AskRow } from '../../../../supabase/functions/ask-cellar/cellar.ts';
import { supabase } from '../lib/supabase';

export type { Answer };

export class AskError extends Error {
  constructor(
    message: string,
    /** True when the function isn't switched on yet. */
    readonly unavailable = false,
  ) {
    super(message);
  }
}

/** Asks the ask-cellar Edge Function (Claude with an exact cellar lookup) a question. */
export async function askCellar(input: {
  question: string;
  rows: AskRow[];
  cellars: string[];
  /** The cellar on screen, or null for all cellars. */
  lookingAt: string | null;
  year: number;
  palate?: string;
}): Promise<Answer> {
  const { data, error } = await supabase.functions.invoke<Answer>('ask-cellar', {
    body: {
      question: input.question,
      rows: input.rows,
      cellars: input.cellars,
      looking_at: input.lookingAt,
      year: input.year,
      ...(input.palate ? { palate: input.palate } : {}),
    },
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
      if (res.status === 404)
        throw new AskError('Asking questions isn’t switched on yet. Search by name for now.', true);
      throw new AskError(
        body.error ?? 'The sommelier isn’t available right now.',
        body.code === 'no_key',
      );
    }
    throw new AskError('No connection. Check the internet and try again.');
  }
  if (!data || typeof data.answer !== 'string') {
    throw new AskError('The sommelier gave an unclear answer. Try again.');
  }
  const ids = (v: unknown) =>
    Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string') : [];
  return {
    answer: data.answer,
    wine_ids: ids(data.wine_ids),
    ...(Array.isArray(data.list_ids) ? { list_ids: ids(data.list_ids) } : {}),
  };
}
