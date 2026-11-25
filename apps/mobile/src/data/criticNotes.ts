import { supabase } from '../lib/supabase';

/**
 * Tasting notes by critics, merchants and the winery, found on public web
 * pages by the gather-notes Edge Function. The Wine page reads them for one
 * vintage at a time.
 */

import { sortNotes, type CriticNote } from '../logic/criticNotes';

export type { CriticNote };
export { noteCaption } from '../logic/criticNotes';

/** The saved notes for a vintage; empty if none yet (or the table is not there yet). */
export async function loadCriticNotes(vintageId: string): Promise<CriticNote[]> {
  const { data, error } = await supabase
    .from('critic_notes')
    .select('id,author,kind,score,noted_on,note,source_url,source_site')
    .eq('vintage_id', vintageId);
  if (error || !data) return [];
  return sortNotes(data as CriticNote[]);
}
