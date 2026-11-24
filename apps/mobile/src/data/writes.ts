import { supabase } from '../lib/supabase';
import type { InventoryRow, Maturity } from '../logic/cellar';

/**
 * Every change the app makes to the cellar. Bottle counts only ever change by
 * adding an inventory event (the database refuses anything else), and every
 * change can be undone by adding the opposite event, so nothing is lost.
 */

function fail(error: { message: string } | null): void {
  if (error) throw new Error(friendly(error.message));
}

function friendly(message: string): string {
  if (/holdings_quantity_check/.test(message)) return 'There are no bottles left to take.';
  if (/holdings_quantity_on_order_check/.test(message))
    return 'That would leave fewer than 0 on order.';
  if (/JWT|not authenticated|permission denied/i.test(message))
    return 'You’ve been signed out. Sign in again and retry.';
  if (/Failed to fetch|Network/i.test(message))
    return 'No connection. Check the internet and retry.';
  return message;
}

/** Removes one bottle from a holding at once. Returns the event id (for Undo and the note). */
export async function drinkOne(holding: InventoryRow): Promise<string> {
  const { data, error } = await supabase
    .from('inventory_events')
    .insert({
      account_id: holding.account_id,
      holding_id: holding.holding_id,
      event_type: 'consumed',
      quantity_delta: -1,
      occurred_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  fail(error);
  return data!.id as string;
}

/** Bottles on order have arrived. */
export async function markDelivered(holding: InventoryRow, count: number): Promise<string> {
  const { data, error } = await supabase
    .from('inventory_events')
    .insert({
      account_id: holding.account_id,
      holding_id: holding.holding_id,
      event_type: 'delivered',
      quantity_delta: count,
      on_order_delta: -count,
      occurred_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  fail(error);
  return data!.id as string;
}

/** Puts things back as they were, by adding opposite events. Safe to call twice. */
export async function undoEvents(eventIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('undo_inventory_events', { p_event_ids: eventIds });
  fail(error);
  return data as number;
}

export type AddLine = {
  /** An existing wine, or leave out and give wine_name for a new one. */
  wine_id?: string;
  wine_name?: string;
  vintage: number | null;
  country?: string | null;
  region?: string | null;
  sub_region?: string | null;
  appellation?: string | null;
  bottle_size_ml: number;
  quantity: number;
  unit_price?: number | null;
  /** Only when the price isn't in the cellar's currency (an invoice in euros for an LA cellar). */
  currency?: string | null;
  merchant?: string | null;
  score_raw?: string | null;
  score_low?: number | null;
  score_high?: number | null;
  score_plus?: boolean;
};

/** Adds bottles (or an order) to a cellar. All lines are added, or none. */
export async function addBottles(
  cellarId: string,
  lines: AddLine[],
  onOrder: boolean,
  reason: string,
): Promise<{ eventIds: string[]; newWines: number }> {
  const { data, error } = await supabase.rpc('add_bottles', {
    p_cellar_id: cellarId,
    p_lines: lines,
    p_on_order: onOrder,
    p_reason: reason,
  });
  fail(error);
  const res = data as { event_ids: string[]; new_wines: number };
  return { eventIds: res.event_ids, newWines: res.new_wines };
}

export type NoteInput = {
  stars: number | null;
  notes: string;
  maturity: Maturity | null;
  food_pairing: string;
  occasion: string;
  would_buy_again: boolean | null;
};

/** Saves (or updates) the note for a bottle just drunk. Stars are stored as a score out of 100. */
export async function saveNote(
  existingId: string | null,
  base: { account_id: string; vintage_id: string; inventory_event_id: string | null },
  input: NoteInput,
): Promise<string> {
  const row = {
    ...base,
    rating: input.stars ? input.stars * 20 : null,
    notes: input.notes.trim() || null,
    maturity: input.maturity,
    food_pairing: input.food_pairing.trim() || null,
    occasion: input.occasion.trim() || null,
    would_buy_again: input.would_buy_again,
  };
  if (existingId) {
    const { error } = await supabase.from('tasting_notes').update(row).eq('id', existingId);
    fail(error);
    return existingId;
  }
  const { data, error } = await supabase.from('tasting_notes').insert(row).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('tasting_notes').delete().eq('id', id);
  fail(error);
}
