// What the invoice reader asks Claude, the shape of the answer, and the checks
// on the incoming webhook. Plain TypeScript with only Web APIs (crypto.subtle,
// TextEncoder, atob), so the app's tests can import it too.

export const MODEL = 'claude-opus-5-5';

/** At most this many invoices are read per account per day (protects the Claude credit). */
export const DAILY_LIMIT = 20;

export type KnownWine = { id: string; name: string; place: string };

export type InvoiceLine = {
  wine_name: string;
  vintage: number | null;
  quantity: number;
  bottle_size_ml: number;
  unit_price: number | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  match_wine_id: string | null;
  note: string | null;
};

export type InvoiceReading = {
  is_wine_invoice: boolean;
  merchant: string | null;
  invoice_date: string | null; // YYYY-MM-DD
  currency: string | null; // ISO code, e.g. USD
  cellar_name: string | null; // one of the account's cellar names, from the ship-to address
  looks_like_order: boolean; // futures / pre-arrival, not delivered yet
  lines: InvoiceLine[];
  note: string | null;
};

const text = { type: ['string', 'null'] };

const LINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'wine_name',
    'vintage',
    'quantity',
    'bottle_size_ml',
    'unit_price',
    'country',
    'region',
    'appellation',
    'match_wine_id',
    'note',
  ],
  properties: {
    wine_name: { type: 'string' },
    vintage: { type: ['integer', 'null'] },
    quantity: { type: 'integer' },
    bottle_size_ml: { type: 'integer' },
    unit_price: { type: ['number', 'null'] },
    country: text,
    region: text,
    appellation: text,
    match_wine_id: text,
    note: text,
  },
} as const;

export const INVOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_wine_invoice',
    'merchant',
    'invoice_date',
    'currency',
    'cellar_name',
    'looks_like_order',
    'lines',
    'note',
  ],
  properties: {
    is_wine_invoice: { type: 'boolean' },
    merchant: text,
    invoice_date: text,
    currency: text,
    cellar_name: text,
    looks_like_order: { type: 'boolean' },
    lines: { type: 'array', items: LINE_SCHEMA },
    note: text,
  },
} as const;

export const SYSTEM = `You read wine purchase invoices, receipts and order confirmations that a collector forwards to a private cellar app, and list exactly which bottles were bought.

The email may be a forwarded message: the invoice can be in the body text, the HTML, or an attached PDF, image or spreadsheet. Ignore signatures, marketing, links and earlier messages in the thread that are not this purchase.

How the cellar names wines (follow this style for wine_name):
- Producer then cuvée, the way a collector writes it in a spreadsheet: "Ridge Monte Bello", "Joseph Phelps Insignia", "Domaine Serene Evenstad Reserve Pinot Noir", "Mario Marengo Barolo Brunate".
- Bordeaux châteaux drop the word "Château": "Lafon Rochet", "Branaire Ducru", "D'Issan". Second wines keep their own name ("Carruades de Lafite").
- Keep accents. Use title case. No vintage, bottle size, case size or merchant codes in the name.

Lines:
- One line per wine, vintage and bottle size. Only wine (and other drinks sold by the bottle). Leave out shipping, tax, duty, deposits, gift wrap, discounts and credit lines.
- quantity: the number of physical bottles. A "case of 12" or "1 x 6" or "6 btl OWC" is 6 or 12 bottles; multiply cases by bottles per case.
- bottle_size_ml: 750 unless the invoice says otherwise (1500 for magnum / 1.5 L, 375 for half bottle, 3000 for double magnum / 3 L).
- unit_price: the price of one bottle before tax and shipping, in the invoice currency. If only a case or line price is shown, divide by the bottles. null if no price is shown.
- vintage: the year shown for that wine. null for NV or if not shown. Never guess a year.
- country (English: "France", "USA"), region ("Bordeaux", "Burgundy", "Napa Valley", "Oregon"), appellation ("Pauillac", "Dundee Hills"): fill from the invoice or your knowledge of the wine; null if unsure.
- match_wine_id: if a line is clearly the same wine (same producer and same cuvée) as one in the cellar list, give that id. A different cuvée from the same producer is not a match.
- note: a short plain sentence only when the owner should check something on that line ("Quantity unclear: says 1 case.").

The whole invoice:
- merchant: the shop or winery that sold it. invoice_date: YYYY-MM-DD if shown. currency: ISO code (USD, EUR, GBP...).
- cellar_name: if a ship-to or delivery address makes it clear which of the owner's cellars this goes to, give that cellar's name exactly as listed. Otherwise null.
- looks_like_order: true if these bottles are clearly not delivered yet (futures, en primeur, pre-arrival, pre-sale, "ships in 2027", allocation reserved). false otherwise.
- note: one short sentence when something needs checking for the whole invoice. Otherwise null.
- If there is no wine purchase in the email, set is_wine_invoice to false, lines to [], and say in note what the email seems to be.`;

export function userText(
  email: { from: string | null; subject: string | null; text: string },
  cellars: string[],
  known: KnownWine[],
): string {
  const list = known.length
    ? known.map((w) => `${w.id} | ${w.name}${w.place ? ` | ${w.place}` : ''}`).join('\n')
    : '(empty)';
  return [
    `The owner's cellars: ${cellars.length ? cellars.join('; ') : '(none)'}`,
    '',
    `Wines already in the cellar (id | name | place):\n${list}`,
    '',
    `Forwarded by: ${email.from ?? 'unknown'}`,
    `Subject: ${email.subject ?? ''}`,
    '',
    'Email text:',
    email.text.trim() || '(no text; see attachments)',
    '',
    'List the bottles bought on this invoice.',
  ].join('\n');
}

/** Checks a reading from the model; returns null if it is not usable. */
export function cleanInvoice(
  raw: unknown,
  known: KnownWine[],
  cellars: string[],
): InvoiceReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const thisYear = new Date().getFullYear();
  const lines: InvoiceLine[] = [];
  for (const item of Array.isArray(r.lines) ? r.lines : []) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const name = str(l.wine_name);
    const qty = int(l.quantity);
    if (!name || qty === null || qty <= 0 || qty > 10000) continue;
    const year = int(l.vintage);
    const size = int(l.bottle_size_ml);
    const price = typeof l.unit_price === 'number' && l.unit_price > 0 ? l.unit_price : null;
    const matchId = str(l.match_wine_id);
    lines.push({
      wine_name: name.slice(0, 200),
      vintage: year !== null && year >= 1800 && year <= thisYear + 1 ? year : null,
      quantity: qty,
      bottle_size_ml: size !== null && size >= 100 && size <= 30000 ? size : 750,
      unit_price: price !== null ? Math.round(price * 100) / 100 : null,
      country: str(l.country),
      region: str(l.region),
      appellation: str(l.appellation),
      match_wine_id: matchId && known.some((w) => w.id === matchId) ? matchId : null,
      note: str(l.note),
    });
  }
  const currency = str(r.currency)?.toUpperCase() ?? null;
  const date = str(r.invoice_date);
  const cellar = str(r.cellar_name);
  return {
    is_wine_invoice: r.is_wine_invoice === true && lines.length > 0,
    merchant: str(r.merchant),
    invoice_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    cellar_name: cellar && cellars.includes(cellar) ? cellar : null,
    looks_like_order: r.looks_like_order === true,
    lines,
    note: str(r.note),
  };
}

/**
 * The account's private code from the addresses an email was sent to
 * ("k7m2...@abc.resend.app" or "Cellar <k7m2...@in.mysommelier.net>").
 * Every candidate is returned; the caller looks each one up.
 */
export function inboxCodes(addresses: unknown[]): string[] {
  const codes = new Set<string>();
  for (const a of addresses) {
    if (typeof a !== 'string') continue;
    for (const m of a.toLowerCase().matchAll(/([a-z0-9._+-]+)@/g)) {
      // Plus addressing works too: invoices+CODE@...
      for (const part of m[1].split('+')) if (/^[a-z0-9]{12,40}$/.test(part)) codes.add(part);
    }
  }
  return [...codes];
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Checks a webhook signature in the Svix format that Resend uses:
 * HMAC-SHA256 over "id.timestamp.body" with the secret (base64 after "whsec_"),
 * sent as "v1,<base64>" (several may be listed, space separated).
 * Rejects timestamps more than 5 minutes away, so old requests can't be replayed.
 */
export async function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base64ToBytes(secret.replace(/^whsec_/, ''));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  const expected = bytesToBase64(mac);
  return signature
    .split(' ')
    .map((s) => s.split(',')[1] ?? '')
    .some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Plain text from an HTML email body (good enough for Claude to read a table). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
