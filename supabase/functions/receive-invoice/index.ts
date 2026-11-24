// Supabase Edge Function: invoices emailed to an account's private address.
//
// Two ways in:
// 1. Resend (the email service) calls it when mail arrives at the receiving
//    domain ("email.received" webhook, signed with RESEND_WEBHOOK_SECRET).
//    The function finds whose private address it was sent to, saves the email
//    as an invoice "reading", answers Resend at once, then reads the invoice
//    with Claude in the background and saves the lines as "ready" to review.
// 2. The app calls it signed in, with { invoice_id }, to read an invoice
//    again (for example after a failure).
//
// It never adds bottles: the owner reviews the lines in the app and confirms.
// Secrets: ANTHROPIC_API_KEY, RESEND_API_KEY, RESEND_WEBHOOK_SECRET.
// Deploy with verify_jwt = false (Resend has no Supabase token).

import Anthropic from 'npm:@anthropic-ai/sdk@1.13.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';

import {
  cleanInvoice,
  DAILY_LIMIT,
  htmlToText,
  INVOICE_SCHEMA,
  inboxCodes,
  MODEL,
  SYSTEM,
  userText,
  verifyWebhook,
  type KnownWine,
} from './invoice.ts';
import { readXlsx } from './xlsx.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESEND = 'https://api.resend.com';
const MAX_FILES = 6;
const MAX_FILE_BYTES = 10_000_000;
const MAX_TOTAL_BYTES = 24_000_000;
const MAX_TEXT = 60_000;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function env(name: string): string {
  return Deno.env.get(name) ?? '';
}

function serviceDb(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function later(work: Promise<unknown>) {
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
  else work.catch((e) => console.error(e));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  if (req.headers.get('svix-signature')) return await fromResend(req);
  return await fromApp(req);
});

// ---------- 1. Mail arriving from Resend ----------

async function fromResend(req: Request): Promise<Response> {
  const raw = await req.text();
  const ok = await verifyWebhook(
    env('RESEND_WEBHOOK_SECRET'),
    {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    raw,
  );
  if (!ok) return reply(401, { error: 'Bad signature.' });

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'Not JSON.' });
  }
  if (event.type !== 'email.received' || !event.data) return reply(200, { ignored: true });
  const d = event.data;
  const emailId = typeof d.email_id === 'string' ? d.email_id : null;
  if (!emailId) return reply(200, { ignored: 'no email id' });

  const recipients = [
    ...(Array.isArray(d.to) ? d.to : []),
    ...(Array.isArray(d.received_for) ? d.received_for : []),
    ...(Array.isArray(d.cc) ? d.cc : []),
    ...(Array.isArray(d.bcc) ? d.bcc : []),
  ];
  const db = serviceDb();
  let accountId: string | null = null;
  for (const code of inboxCodes(recipients)) {
    const { data } = await db.rpc('invoice_inbox_account', { p_code: code });
    if (data) {
      accountId = data as string;
      break;
    }
  }
  // Unknown address: answer 200 so Resend doesn't retry, and keep nothing.
  if (!accountId) {
    console.log('invoice email to an unknown address', emailId);
    return reply(200, { ignored: 'unknown address' });
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db
    .from('invoice_emails')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .gte('received_at', since);
  const overLimit = (count ?? 0) >= DAILY_LIMIT;

  const { data: row, error } = await db
    .from('invoice_emails')
    .upsert(
      {
        account_id: accountId,
        provider_email_id: emailId,
        from_address: typeof d.from === 'string' ? d.from.slice(0, 300) : null,
        subject: typeof d.subject === 'string' ? d.subject.slice(0, 500) : null,
        status: overLimit ? 'failed' : 'reading',
        error: overLimit
          ? `More than ${DAILY_LIMIT} invoices arrived today, so this one wasn’t read. Tap Read again tomorrow.`
          : null,
      },
      { onConflict: 'provider_email_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('save invoice failed', error.message);
    return reply(500, { error: 'Could not save.' }); // Resend retries
  }
  if (!row) return reply(200, { duplicate: true });
  if (!overLimit) later(readInvoice(db, row.id as string));
  return reply(200, { saved: row.id });
}

// ---------- 2. "Read again" from the app ----------

async function fromApp(req: Request): Promise<Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const anonKey = env('SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY');
  if (!token || !anonKey) return reply(401, { error: 'Sign in first.' });
  const asUser = createClient(env('SUPABASE_URL'), anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: who, error: authError } = await asUser.auth.getUser(token);
  if (authError || !who?.user) return reply(401, { error: 'Sign in first.' });

  let body: { invoice_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Send JSON.' });
  }
  const id = typeof body.invoice_id === 'string' ? body.invoice_id : '';
  // Row-level security: the user only sees their own account's invoices.
  const { data: mine } = await asUser
    .from('invoice_emails')
    .select('id,status')
    .eq('id', id)
    .maybeSingle();
  if (!mine) return reply(404, { error: 'Invoice not found.' });
  if (mine.status === 'added') return reply(409, { error: 'This invoice is already added.' });

  const db = serviceDb();
  await db.from('invoice_emails').update({ status: 'reading', error: null }).eq('id', id);
  later(readInvoice(db, id));
  return reply(202, { reading: id });
}

// ---------- Reading an invoice ----------

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function resendGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${RESEND}${path}`, {
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}` },
  });
  if (!res.ok) throw new Error(`Couldn’t fetch the email from Resend (${res.status}).`);
  return await res.json();
}

async function readInvoice(db: SupabaseClient, id: string): Promise<void> {
  const fail = (msg: string) =>
    db.from('invoice_emails').update({ status: 'failed', error: msg }).eq('id', id);
  try {
    const { data: inv } = await db
      .from('invoice_emails')
      .select('id,account_id,provider_email_id,from_address,subject')
      .eq('id', id)
      .single();
    if (!inv) return;
    if (!env('ANTHROPIC_API_KEY')) return void (await fail('The invoice reader isn’t set up.'));
    if (!env('RESEND_API_KEY')) return void (await fail('The RESEND_API_KEY secret is missing.'));

    const email = await resendGet(`/emails/receiving/${inv.provider_email_id}`);
    const list = await resendGet(`/emails/receiving/${inv.provider_email_id}/attachments`);
    const attachments = (Array.isArray(list.data) ? list.data : []) as Record<string, unknown>[];

    const blocks: Block[] = [];
    const extraText: string[] = [];
    let total = 0;
    let used = 0;
    for (const a of attachments) {
      if (used >= MAX_FILES) break;
      const name = String(a.filename ?? 'attachment');
      const type = String(a.content_type ?? '').toLowerCase();
      const size = Number(a.size ?? 0);
      const inline = String(a.content_disposition ?? '') === 'inline';
      const isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);
      const isImage = /^image\/(jpeg|png|webp|gif)$/.test(type);
      const isSheet = /\.xlsx$/i.test(name) || type.includes('spreadsheetml');
      const isText = /\.(csv|txt)$/i.test(name) || type === 'text/csv' || type === 'text/plain';
      if (!isPdf && !isImage && !isSheet && !isText) continue;
      // Small inline pictures are logos and signatures, not invoices.
      if (isImage && (inline || size < 40_000)) continue;
      if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) continue;
      if (typeof a.download_url !== 'string') continue;
      const res = await fetch(a.download_url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      total += bytes.length;
      used++;
      if (isPdf) {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) },
        });
      } else if (isImage) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: type, data: toBase64(bytes) },
        });
      } else if (isSheet) {
        const rows = readXlsx(bytes);
        extraText.push(
          `Attached spreadsheet ${name}:\n${rows.map((r) => r.join(' | ')).join('\n')}`,
        );
      } else {
        extraText.push(`Attached file ${name}:\n${new TextDecoder().decode(bytes)}`);
      }
    }

    const bodyText =
      (typeof email.text === 'string' && email.text.trim()) ||
      (typeof email.html === 'string' ? htmlToText(email.html) : '');
    const text = [bodyText, ...extraText].join('\n\n').slice(0, MAX_TEXT);

    const [{ data: cellarRows }, { data: wineRows }] = await Promise.all([
      db.from('cellars').select('id,name').eq('account_id', inv.account_id),
      db
        .from('wines')
        .select('id,name,country,region,appellation')
        .eq('account_id', inv.account_id)
        .order('name')
        .limit(3000),
    ]);
    const cellars = (cellarRows ?? []) as { id: string; name: string }[];
    const known: KnownWine[] = ((wineRows ?? []) as Record<string, string | null>[]).map((w) => ({
      id: w.id!,
      name: w.name!,
      place: [w.appellation, w.region, w.country].filter(Boolean).join(', '),
    }));
    const cellarNames = cellars.map((c) => c.name);

    const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: INVOICE_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...(blocks as Anthropic.Beta.Messages.BetaContentBlockParam[]),
            {
              type: 'text',
              text: userText(
                { from: inv.from_address, subject: inv.subject, text },
                cellarNames,
                known,
              ),
            },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal')
      return void (await fail('The reader couldn’t read this email.'));
    const block = response.content.find((b) => b.type === 'text');
    let parsed: unknown = null;
    try {
      parsed = block && block.type === 'text' ? JSON.parse(block.text) : null;
    } catch {
      parsed = null;
    }
    const reading = cleanInvoice(parsed, known, cellarNames);
    if (!reading) return void (await fail('The reader gave an unclear answer. Tap Read again.'));

    const cellarId = cellars.find((c) => c.name === reading.cellar_name)?.id ?? null;
    await db
      .from('invoice_emails')
      .update({
        status: reading.is_wine_invoice ? 'ready' : 'failed',
        error: reading.is_wine_invoice
          ? null
          : (reading.note ?? 'No wine purchase found in this email.'),
        reading: { ...reading, usage: response.usage },
        cellar_id: cellarId,
      })
      .eq('id', id);
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Anthropic.AuthenticationError) msg = 'The ANTHROPIC_API_KEY was refused.';
    else if (e instanceof Anthropic.APIError)
      msg = /credit|billing/i.test(e.message)
        ? 'The reader is out of Claude credit. Add credit at platform.claude.com.'
        : 'The reader is unavailable right now. Tap Read again shortly.';
    console.error('read invoice failed', id, e);
    await fail(msg);
  }
}
