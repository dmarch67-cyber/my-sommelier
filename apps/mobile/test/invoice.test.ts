import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  cleanInvoice,
  htmlToText,
  inboxCodes,
  INVOICE_SCHEMA,
  senderEmail,
  senderVerified,
  userText,
  verifyWebhook,
} from '../../../supabase/functions/receive-invoice/invoice.ts';
import type { InventoryRow } from '../src/logic/cellar.ts';
import { fromInvoice, reviewTotals, toAddLines } from '../src/logic/review.ts';

function row(over: Partial<InventoryRow>): InventoryRow {
  return {
    holding_id: 'h',
    account_id: 'acc',
    cellar_id: 'la',
    cellar_name: 'LA home',
    wine_id: 'w1',
    wine_name: 'Ridge Monte Bello',
    producer: null,
    country: 'USA',
    region: 'California',
    appellation: 'Santa Cruz',
    colour: null,
    vintage_id: 'v1',
    vintage: 2015,
    drink_from: null,
    drink_to: null,
    bottle_size_ml: 750,
    bottle_size_label: 'Standard',
    is_non_standard_size: false,
    quantity: 1,
    quantity_on_order: 0,
    unit_price: null,
    currency: null,
    ...over,
  } as InventoryRow;
}

const KNOWN = [{ id: 'w1', name: 'Ridge Monte Bello', place: 'Santa Cruz, California, USA' }];
const CELLARS = ['LA home', 'Oregon home', 'Paris'];

// ---------- webhook signature (Svix format, as Resend sends) ----------

const SECRET_BYTES = Buffer.from('a-test-secret-of-some-length-123');
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

function sign(id: string, ts: string, body: string): string {
  return `v1,${createHmac('sha256', SECRET_BYTES).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

test('a correctly signed webhook is accepted', async () => {
  const now = 1_790_000_000;
  const body = '{"type":"email.received"}';
  const sig = sign('msg_1', String(now), body);
  assert.equal(
    await verifyWebhook(SECRET, { id: 'msg_1', timestamp: String(now), signature: sig }, body, now),
    true,
  );
  // Several signatures listed (during a secret rotation): any one may match.
  assert.equal(
    await verifyWebhook(
      SECRET,
      { id: 'msg_1', timestamp: String(now), signature: `v1,bm9wZQ== ${sig}` },
      body,
      now,
    ),
    true,
  );
});

test('a changed body, wrong secret, old timestamp or missing header is refused', async () => {
  const now = 1_790_000_000;
  const body = '{"type":"email.received"}';
  const sig = sign('msg_1', String(now), body);
  const h = { id: 'msg_1', timestamp: String(now), signature: sig };
  assert.equal(await verifyWebhook(SECRET, h, body + ' ', now), false);
  assert.equal(await verifyWebhook('whsec_b3RoZXI=', h, body, now), false);
  assert.equal(await verifyWebhook(SECRET, h, body, now + 301), false);
  assert.equal(await verifyWebhook(SECRET, { ...h, signature: null }, body, now), false);
  assert.equal(await verifyWebhook('', h, body, now), false);
});

// ---------- whose address ----------

test('the private code is found in the recipient addresses', () => {
  assert.deepEqual(inboxCodes(['k7m2p9q4r8s3t6vw@abc123.resend.app']), ['k7m2p9q4r8s3t6vw']);
  assert.deepEqual(inboxCodes(['"My Sommelier" <K7M2P9Q4R8S3T6VW@in.mysommelier.net>']), [
    'k7m2p9q4r8s3t6vw',
  ]);
  assert.deepEqual(inboxCodes(['invoices+k7m2p9q4r8s3t6vw@in.mysommelier.net']), [
    'k7m2p9q4r8s3t6vw',
  ]);
  assert.deepEqual(inboxCodes(['dan@example.com', 42, null]), []);
});

// ---------- the reading ----------

test('the schema asks for every field it lists', () => {
  assert.deepEqual(
    [...INVOICE_SCHEMA.required].sort(),
    Object.keys(INVOICE_SCHEMA.properties).sort(),
  );
  const line = INVOICE_SCHEMA.properties.lines.items;
  assert.deepEqual([...line.required].sort(), Object.keys(line.properties).sort());
});

test('the prompt lists cellars, known wines and the email', () => {
  const t = userText(
    { from: 'dan@x.com', subject: 'Your order', text: 'Latour 2010 x 6' },
    CELLARS,
    KNOWN,
  );
  assert.match(t, /LA home; Oregon home; Paris/);
  assert.match(t, /w1 \| Ridge Monte Bello/);
  assert.match(t, /Latour 2010 x 6/);
});

test('a reading is cleaned: bad lines dropped, unknown ids and cellars removed', () => {
  const r = cleanInvoice(
    {
      is_wine_invoice: true,
      merchant: ' K&L Wine Merchants ',
      invoice_date: '2026-11-20',
      currency: 'usd',
      cellar_name: 'Somewhere else',
      looks_like_order: true,
      note: null,
      lines: [
        {
          wine_name: 'Ridge Monte Bello',
          vintage: 2021,
          quantity: 6,
          bottle_size_ml: 750,
          unit_price: 249.999,
          country: 'USA',
          region: 'California',
          appellation: null,
          match_wine_id: 'w1',
          note: null,
        },
        { wine_name: 'Shipping', vintage: null, quantity: 0, bottle_size_ml: 750 },
        {
          wine_name: 'Latour',
          vintage: 1700,
          quantity: 2,
          bottle_size_ml: 5,
          match_wine_id: 'zzz',
        },
      ],
    },
    KNOWN,
    CELLARS,
  )!;
  assert.equal(r.merchant, 'K&L Wine Merchants');
  assert.equal(r.currency, 'USD');
  assert.equal(r.cellar_name, null);
  assert.equal(r.looks_like_order, true);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[0].unit_price, 250);
  assert.equal(r.lines[0].match_wine_id, 'w1');
  assert.equal(r.lines[1].vintage, null);
  assert.equal(r.lines[1].bottle_size_ml, 750);
  assert.equal(r.lines[1].match_wine_id, null);
  assert.equal(cleanInvoice('nope', KNOWN, CELLARS), null);
});

test('an email with no wine lines is not a wine invoice', () => {
  const r = cleanInvoice(
    { is_wine_invoice: true, lines: [], note: 'A newsletter.' },
    KNOWN,
    CELLARS,
  )!;
  assert.equal(r.is_wine_invoice, false);
});

test('HTML invoices become readable text, table cells kept apart', () => {
  const t = htmlToText(
    '<html><head><style>x{}</style></head><body><table><tr><td>Latour 2010</td><td>6</td></tr></table>Total&nbsp;&amp; tax</body></html>',
  );
  assert.match(t, /Latour 2010 \| 6/);
  assert.match(t, /Total & tax/);
  assert.doesNotMatch(t, /x\{\}/);
});

// ---------- review lines ----------

test('invoice lines match cellar wines by id or name, and keep a foreign currency', () => {
  const inventory = [row({})];
  const lines = fromInvoice(inventory, {
    is_wine_invoice: true,
    merchant: 'Lavinia',
    invoice_date: null,
    currency: 'EUR',
    cellar_name: 'Paris',
    looks_like_order: false,
    note: null,
    lines: [
      {
        wine_name: 'Ridge Monte Bello',
        vintage: 2019,
        quantity: 3,
        bottle_size_ml: 750,
        unit_price: 200,
        country: null,
        region: null,
        appellation: null,
        match_wine_id: null,
        note: null,
      },
      {
        wine_name: 'Lafon Rochet',
        vintage: 2016,
        quantity: 12,
        bottle_size_ml: 750,
        unit_price: 45,
        country: 'France',
        region: 'Bordeaux',
        appellation: 'Saint-Estèphe',
        match_wine_id: null,
        note: 'Case of 12.',
      },
    ],
  });
  assert.equal(lines[0].match?.wineId, 'w1');
  assert.equal(lines[1].match, null);
  assert.equal(lines[1].note, 'Case of 12.');
  const t = reviewTotals(lines);
  assert.equal(t.bottles, 15);
  assert.equal(t.newWines, 1);
  assert.equal(t.cost, 600 + 540);

  const usd = toAddLines(lines, 'USD', 'Lavinia');
  assert.equal(usd[0].wine_id, 'w1');
  assert.equal(usd[0].currency, 'EUR');
  assert.equal(usd[1].wine_name, 'Lafon Rochet');
  assert.equal(usd[1].appellation, 'Saint-Estèphe');
  assert.equal(usd[1].merchant, 'Lavinia');
  // Same currency as the cellar: left out, the cellar's is used.
  assert.equal(toAddLines(lines, 'EUR')[0].currency, null);
  // Unticked lines are not added.
  lines[1].include = false;
  assert.equal(toAddLines(lines, 'EUR').length, 1);
});

// ---------- shared address: who sent it ----------

test('the sender address is read from a From line', () => {
  assert.equal(senderEmail('Dan March <Dan@Example.com>'), 'dan@example.com');
  assert.equal(senderEmail('dan@example.com'), 'dan@example.com');
  assert.equal(senderEmail('"Shop, Inc" <orders@shop.com>'), 'orders@shop.com');
  assert.equal(senderEmail(null), null);
  assert.equal(senderEmail('no address here'), null);
});

test('only mail signed by the sender (DKIM) or passing DMARC is trusted', () => {
  assert.equal(senderVerified({ spf: 'pass', dkim: 'pass', dmarc: 'pass' }), true);
  assert.equal(senderVerified({ spf: 'fail', dkim: 'pass', dmarc: 'fail' }), true);
  assert.equal(senderVerified({ spf: 'pass', dkim: 'fail', dmarc: 'pass' }), true);
  assert.equal(senderVerified({ spf: 'pass', dkim: 'fail', dmarc: 'fail' }), false);
  assert.equal(senderVerified(undefined), false);
});
