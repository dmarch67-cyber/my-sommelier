import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';
import type { KnownWine, LabelReading } from '../logic/label';

export class LabelError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** Sends a label photo to the label reader (a Supabase Edge Function that asks Claude). */
export async function readLabel(
  base64: string,
  mediaType: string,
  known: KnownWine[],
): Promise<LabelReading> {
  const { data, error } = await supabase.functions.invoke('read-label', {
    body: { image: base64, media_type: mediaType, known },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let body: { error?: string; code?: string } = {};
      try {
        body = await (error.context as Response).json();
      } catch {
        // not JSON
      }
      throw new LabelError(body.error ?? 'The label reader isn’t available right now.', body.code);
    }
    throw new LabelError('No connection. Check the internet and try again.');
  }
  const reading = (data as { reading?: LabelReading } | null)?.reading;
  if (!reading) throw new LabelError('The label reader gave an unclear answer. Try again.');
  return reading;
}
