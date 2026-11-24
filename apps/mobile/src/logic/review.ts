/**
 * Lines to check before they are added: shared by the delivery upload and
 * emailed invoices. Pure logic (no React, no Supabase) so it runs in tests.
 */
import type { InvoiceReading } from '../../../../supabase/functions/receive-invoice/invoice.ts';
import type { AddLine } from '../data/writes.ts';
import { exactWine, findWines, type parseScore } from './adding.ts';
import type { InventoryRow } from './cellar.ts';
import type { DeliveryLine } from './delivery.ts';

export type { InvoiceReading };

export type ReviewLine = {
  key: string;
  /** Where Dan finds it in the original: "row 5" or "line 2". */
  where: string;
  wineName: string;
  vintage: number | null;
  quantity: number;
  sizeMl: number;
  unitPrice: number | null;
  /** Price currency when it isn't the cellar's (from an invoice); null = cellar currency. */
  currency: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  score: ReturnType<typeof parseScore>;
  /** Something the reader wants Dan to check on this line. */
  note: string | null;
  include: boolean;
  /** Existing wine this line adds to; null = new wine. */
  match: { wineId: string; name: string } | null;
  /** A close name Dan can tap to use instead of creating a new wine. */
  suggestion: { wineId: string; name: string } | null;
};

type Base = Omit<ReviewLine, 'include' | 'match' | 'suggestion'>;

function withMatch(inventory: InventoryRow[], base: Base, matchId: string | null): ReviewLine {
  const byId = matchId ? inventory.find((r) => r.wine_id === matchId) : undefined;
  const exact = byId ?? exactWine(inventory, base.wineName);
  const near = exact ? null : findWines(inventory, base.wineName, 1)[0];
  return {
    ...base,
    include: true,
    match: exact ? { wineId: exact.wine_id, name: exact.wine_name } : null,
    suggestion: near ? { wineId: near.wineId, name: near.name } : null,
  };
}

export function fromDelivery(inventory: InventoryRow[], lines: DeliveryLine[]): ReviewLine[] {
  return lines.map((l) =>
    withMatch(
      inventory,
      {
        key: `row-${l.row}`,
        where: `row ${l.row}`,
        wineName: l.wineName,
        vintage: l.vintage,
        quantity: l.quantity,
        sizeMl: l.sizeMl,
        unitPrice: l.unitPrice,
        currency: null,
        country: l.country,
        region: l.region,
        appellation: null,
        score: l.score,
        note: null,
      },
      null,
    ),
  );
}

export function fromInvoice(inventory: InventoryRow[], reading: InvoiceReading): ReviewLine[] {
  return reading.lines.map((l, i) =>
    withMatch(
      inventory,
      {
        key: `line-${i}`,
        where: `line ${i + 1}`,
        wineName: l.wine_name,
        vintage: l.vintage,
        quantity: l.quantity,
        sizeMl: l.bottle_size_ml,
        unitPrice: l.unit_price,
        currency: reading.currency,
        country: l.country,
        region: l.region,
        appellation: l.appellation,
        score: null,
        note: l.note,
      },
      l.match_wine_id,
    ),
  );
}

export function reviewTotals(lines: ReviewLine[]) {
  const chosen = lines.filter((l) => l.include);
  return {
    chosen,
    lines: chosen.length,
    bottles: chosen.reduce((n, l) => n + l.quantity, 0),
    newWines: new Set(chosen.filter((l) => !l.match).map((l) => l.wineName.toLowerCase())).size,
    cost: chosen.reduce((n, l) => n + (l.unitPrice ?? 0) * l.quantity, 0),
  };
}

/** What add_bottles() gets. New wines are matched by name in the database too. */
export function toAddLines(
  lines: ReviewLine[],
  cellarCurrency: string,
  merchant: string | null = null,
): AddLine[] {
  return lines
    .filter((l) => l.include)
    .map((l) => ({
      ...(l.match
        ? { wine_id: l.match.wineId }
        : {
            wine_name: l.wineName,
            region: l.region,
            country: l.country,
            appellation: l.appellation,
          }),
      vintage: l.vintage,
      quantity: l.quantity,
      bottle_size_ml: l.sizeMl,
      unit_price: l.unitPrice,
      currency:
        l.unitPrice != null && l.currency && l.currency !== cellarCurrency ? l.currency : null,
      merchant,
      score_raw: l.score?.raw ?? null,
      score_low: l.score?.low ?? null,
      score_high: l.score?.high ?? null,
      score_plus: l.score?.plus ?? false,
    }));
}
