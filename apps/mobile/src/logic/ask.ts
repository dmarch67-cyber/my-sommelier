/**
 * "Ask anything" in the Cellar search box: deciding when what was typed is a
 * question rather than a wine name, and describing the cellar for the
 * ask-cellar Edge Function. Pure logic, so it runs in plain Node tests.
 */

import type { AskRow } from '../../../../supabase/functions/ask-cellar/cellar.ts';
import {
  bestScoreByVintage,
  drinkWindow,
  scoreLabel,
  scoreValue,
  type InventoryRow,
  type Maturity,
  type Score,
  type TastingNote,
} from './cellar.ts';
import { readiness } from './tonight.ts';

export type { AskRow };

const MAGNUM_ML = 1500;

/** Words that start a question or a request rather than a wine name. */
const QUESTION_START = new Set([
  'what',
  'whats',
  'which',
  'how',
  'when',
  'where',
  'who',
  'whose',
  'why',
  'is',
  'are',
  'am',
  'do',
  'does',
  'did',
  'have',
  'has',
  'should',
  'shall',
  'can',
  'could',
  'would',
  'will',
  'any',
  'anything',
  'show',
  'list',
  'tell',
  'find',
  'give',
  'recommend',
  'suggest',
  'count',
  'total',
  'best',
  'top',
  'oldest',
  'youngest',
  'most',
  'least',
  'my',
  'i',
  'help',
  'please',
  'compare',
]);

/**
 * True when the text should be answered, not just used as a name filter:
 * it ends with "?", starts like a question ("which…", "how many…"),
 * or matches no wine by name.
 */
export function looksLikeQuestion(text: string, nameMatches: number): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  const first = t
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .find(Boolean);
  if (first && QUESTION_START.has(first)) return true;
  return nameMatches === 0;
}

/** How far along a wine is: 0 = window opens now, 1 = window ends now, above 1 = past it. */
export function maturityProgress(
  from: number | null,
  to: number | null,
  year: number,
  call: Maturity | null,
): number | null {
  let p: number | null = null;
  if (from != null || to != null) {
    const start = from ?? to! - 10;
    const end = to ?? start + 10;
    p = (year - start) / Math.max(end - start, 1);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  switch (call) {
    case 'past_it':
      return round(Math.max(p ?? 0, 1.3));
    case 'declining':
      return round(Math.max(p ?? 0, 1.05));
    case 'peak':
      return round(Math.max(p ?? 0, 0.5));
    case 'ready':
      return round(Math.max(p ?? 0, 0.2));
    case 'too_young':
      return round(Math.min(p ?? -0.2, -0.05));
    default:
      return p == null ? null : round(p);
  }
}

function noteLine(n: TastingNote): string {
  const parts = [
    n.tasted_on ?? '',
    n.rating != null ? `${Math.round(n.rating)}/100` : '',
    n.liked === true ? 'liked' : n.liked === false ? 'not for me' : '',
    n.notes ?? '',
    n.food_pairing ? `with ${n.food_pairing}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

/** One row per wine-vintage per cellar, with everything a question might need. */
export function buildAskRows(input: {
  inventory: InventoryRow[];
  scores: Score[];
  notes: TastingNote[];
  maturity: Map<string, Maturity>;
  critics: Map<string, { text: string }>;
  year: number;
  bestScores?: Map<string, Score>;
}): AskRow[] {
  const best = input.bestScores ?? bestScoreByVintage(input.scores);
  const notesBy = new Map<string, TastingNote[]>();
  for (const n of input.notes) {
    const list = notesBy.get(n.vintage_id) ?? [];
    list.push(n);
    notesBy.set(n.vintage_id, list);
  }
  const rows = new Map<string, AskRow>();
  for (const r of input.inventory) {
    if (r.quantity === 0 && r.quantity_on_order === 0) continue;
    const key = `${r.vintage_id}|${r.cellar_id}`;
    let row = rows.get(key);
    if (!row) {
      const top = best.get(r.vintage_id) ?? null;
      const w = drinkWindow(r.drink_from, r.drink_to, top);
      const call = input.maturity.get(r.vintage_id) ?? null;
      const ready = readiness(w.from, w.to, input.year, call);
      const mine = (notesBy.get(r.vintage_id) ?? [])
        .filter((n) => n.notes || n.rating != null || n.liked != null)
        .sort((a, b) => (b.tasted_on ?? b.created_at).localeCompare(a.tasted_on ?? a.created_at))
        .slice(0, 3)
        .map(noteLine);
      row = {
        id: r.vintage_id,
        wine_id: r.wine_id,
        cellar: r.cellar_name,
        name: r.wine_name,
        producer: r.producer,
        vintage: r.vintage,
        country: r.country,
        region: r.region,
        sub_region: r.sub_region ?? null,
        appellation: r.appellation,
        colour: r.colour,
        body: r.body ?? null,
        grapes: r.grapes ?? [],
        bottles: 0,
        magnums: 0,
        other_sizes: 0,
        on_order: 0,
        score: top ? Math.round((scoreValue(top) ?? 0) * 10) / 10 || null : null,
        score_text: top ? scoreLabel(top.raw_value) : null,
        drink_from: w.from,
        drink_to: w.to,
        ready: ready.state,
        ready_label: ready.label,
        maturity: maturityProgress(w.from, w.to, input.year, call),
        price: null,
        currency: null,
        cost: null,
        priced_bottles: 0,
        critics: input.critics.get(r.vintage_id)?.text ?? null,
        my_notes: mine,
      };
      rows.set(key, row);
    }
    row.bottles += r.quantity;
    row.on_order += r.quantity_on_order;
    if (r.bottle_size_ml === MAGNUM_ML) row.magnums += r.quantity;
    else if (r.bottle_size_ml > 750) row.other_sizes += r.quantity;
    // One currency per row: a line bought in another currency stays unpriced here.
    if (
      r.unit_price != null &&
      r.currency &&
      r.quantity > 0 &&
      (row.currency == null || row.currency === r.currency)
    ) {
      row.cost = (row.cost ?? 0) + Number(r.unit_price) * r.quantity;
      row.priced_bottles += r.quantity;
      row.currency = row.currency ?? r.currency;
    }
  }
  for (const row of rows.values()) {
    if (row.cost != null && row.priced_bottles > 0) {
      row.cost = Math.round(row.cost * 100) / 100;
      row.price = Math.round((row.cost / row.priced_bottles) * 100) / 100;
    }
  }
  return [...rows.values()];
}

/** The wines under an answer: the highlighted ones first, then the rest of the counted list. */
export function answerWineIds(answer: { wine_ids: string[]; list_ids?: string[] }): string[] {
  return [...new Set([...answer.wine_ids, ...(answer.list_ids ?? [])])];
}

/** How many wines an answer lists before "Show all". */
export const ANSWER_PAGE = 25;
