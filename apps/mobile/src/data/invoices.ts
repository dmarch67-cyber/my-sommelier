import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';
import type { InvoiceReading } from '../logic/review';

/**
 * Invoices emailed to the account's private address. The receive-invoice
 * Edge Function saves and reads them; the app lists them, lets Dan check the
 * lines, and marks each one added (or dismissed) once he has decided.
 */

export type InvoiceStatus = 'reading' | 'ready' | 'failed' | 'added' | 'dismissed';

export type InvoiceEmail = {
  id: string;
  account_id: string;
  from_address: string | null;
  subject: string | null;
  received_at: string;
  status: InvoiceStatus;
  error: string | null;
  reading: InvoiceReading | null;
  cellar_id: string | null;
  added_event_ids: string[];
};

const COLUMNS =
  'id,account_id,from_address,subject,received_at,status,error,reading,cellar_id,added_event_ids';

function fail(error: { message: string } | null): void {
  if (!error) return;
  if (/Failed to fetch|Network/i.test(error.message))
    throw new Error('No connection. Check the internet and retry.');
  throw new Error(error.message);
}

/** The signed-in user's account (v1: one account per user). */
export async function myAccountId(): Promise<string | null> {
  const { data, error } = await supabase.from('accounts').select('id').order('created_at').limit(1);
  fail(error);
  return (data?.[0]?.id as string | undefined) ?? null;
}

export type InvoiceAddress = {
  /** The account's private address (works from any sender). */
  address: string | null;
  /** The easy shared address (add@mysommelier.net), when set up. */
  shared: string | null;
  /** The sign-in email: the shared address only accepts mail from it. */
  sender: string | null;
};

/**
 * The private address to forward invoices to. Made the first time it's asked
 * for; fresh = make a new one (the old one stops working).
 * address is null while the email service isn't set up yet.
 */
export async function invoiceAddress(accountId: string, fresh = false): Promise<InvoiceAddress> {
  const { data, error } = await supabase.rpc('invoice_email_address', {
    p_account_id: accountId,
    p_new: fresh,
  });
  if (error && /invoice_email_address/.test(error.message))
    return { address: null, shared: null, sender: null }; // database not updated yet
  fail(error);
  const d = (data ?? {}) as Partial<InvoiceAddress>;
  return { address: d.address ?? null, shared: d.shared ?? null, sender: d.sender ?? null };
}

export async function listInvoices(): Promise<InvoiceEmail[]> {
  const { data, error } = await supabase
    .from('invoice_emails')
    .select(COLUMNS)
    .order('received_at', { ascending: false })
    .limit(50);
  if (error && /invoice_emails/.test(error.message)) return []; // not set up yet
  fail(error);
  return (data ?? []) as InvoiceEmail[];
}

export async function getInvoice(id: string): Promise<InvoiceEmail | null> {
  const { data, error } = await supabase
    .from('invoice_emails')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  fail(error);
  return (data as InvoiceEmail | null) ?? null;
}

export async function setInvoiceStatus(
  id: string,
  status: 'ready' | 'added' | 'dismissed',
  extra: { cellar_id?: string | null; added_event_ids?: string[] } = {},
): Promise<void> {
  const { error } = await supabase
    .from('invoice_emails')
    .update({ status, ...extra })
    .eq('id', id);
  fail(error);
}

/** Asks the reader to read an invoice again (after a failure, or to try once more). */
export async function readAgain(id: string): Promise<void> {
  const { error } = await supabase.functions.invoke('receive-invoice', {
    body: { invoice_id: id },
  });
  if (!error) return;
  if (error instanceof FunctionsHttpError) {
    let body: { error?: string } = {};
    try {
      body = await (error.context as Response).json();
    } catch {
      // not JSON
    }
    throw new Error(body.error ?? 'The invoice reader isn’t available right now.');
  }
  throw new Error('No connection. Check the internet and try again.');
}
