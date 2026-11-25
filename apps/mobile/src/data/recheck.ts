import { supabase } from '../lib/supabase';

/**
 * "Recheck window" on the Wine page: asks the assess-wines Edge Function to
 * look at one vintage's drinking window again (fresh web search, critic
 * reviews, recent notes) and save the new one. Takes about a minute and
 * costs a few cents.
 */

export type RecheckResult = {
  before: { drink_from: number | null; drink_to: number | null };
  after: {
    drink_from: number;
    drink_to: number;
    maturity: string | null;
    confidence: 'low' | 'medium' | 'high';
  };
  why: string;
  summary: string;
  /** True when the owner had typed in their own window, which is kept. */
  kept_owner: boolean;
  sources: { url: string; title: string }[];
  cost_usd: number;
};

export async function recheckWindow(vintageId: string): Promise<RecheckResult> {
  const { data, error } = await supabase.functions.invoke<RecheckResult>('assess-wines', {
    body: { vintage_id: vintageId },
  });
  if (error) {
    // The function explains itself in { error } (busy, daily limit, ...).
    let message = 'The recheck did not finish. Please try again.';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json().catch(() => null);
      if (body?.error) message = String(body.error);
    }
    throw new Error(message);
  }
  if (!data?.after) throw new Error('The recheck did not finish. Please try again.');
  return data;
}
