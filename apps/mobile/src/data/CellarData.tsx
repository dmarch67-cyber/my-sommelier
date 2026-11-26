import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { supabase } from '../lib/supabase';
import { fillInWines } from './enrich';
import { loadLabels, NO_LABELS, type Labels } from './labels';
import { savePalate } from './writes';
import {
  bestScoreByVintage,
  type Accolade,
  type Cellar,
  type InventoryRow,
  type Maturity,
  type Score,
  type TastingNote,
} from '../logic/cellar';
import { buildProfile, type PalateProfile, type VintageDrinking } from '../logic/palate';

/**
 * Loads the signed-in account's cellar once and keeps it in memory. Dan's
 * whole cellar is under 1,000 holdings, so one load makes every screen instant.
 *
 * Every read goes through row-level security, so this only ever sees the
 * signed-in user's own account. When the app gets an offline copy
 * (PowerSync), this provider is the one place that changes.
 */

type CellarData = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  cellars: Cellar[];
  inventory: InventoryRow[];
  scores: Score[];
  accolades: Accolade[];
  notes: TastingNote[];
  /** How mature recent notes say each vintage is (from the blended reviews), by vintage id. */
  maturity: Map<string, Maturity>;
  /** "What critics and drinkers say" for each vintage, by vintage id. */
  critics: Map<string, CriticsSay>;
  bestScores: Map<string, Score>;
  /** Label pictures by wine and by vintage (see labelFor); none = the monogram tile. */
  labels: Labels;
  /** Bottles bought and drunk per vintage (all cellars), for the palate profile. */
  drinking: VintageDrinking[];
  /** The taste quiz answers and lines marked "not really"; null until saved once. */
  palateSettings: PalateSettings | null;
  /** The owner's palate, worked out from all of the above. */
  palate: PalateProfile;
  /** The signed-in user's account (for saving settings and new cellars). */
  accountId: string | null;
  /** That account's row (null until loaded). */
  account: { id: string; name: string } | null;
  /** Changes the quiz answers or "not really" lines: shown at once, saved in the background. */
  updatePalate: (settings: PalateSettings) => Promise<void>;
  /** Fetches everything again. Screens keep showing the old data meanwhile. */
  reload: () => Promise<void>;
};

/** latestYear: the newest note the review found, shown as "Notes through 2024". */
export type PalateSettings = { quiz: Record<string, string | string[]>; not_really: string[] };

export type CriticsSay = { text: string; url: string | null; latestYear: number | null };

const Ctx = createContext<CellarData | null>(null);

const PAGE = 1000; // Supabase returns at most 1,000 rows per request.

async function fetchAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

const INVENTORY_COLUMNS = [
  'holding_id',
  'account_id',
  'cellar_id',
  'cellar_name',
  'wine_id',
  'wine_name',
  'producer',
  'country',
  'region',
  'appellation',
  'colour',
  'vintage_id',
  'vintage',
  'drink_from',
  'drink_to',
  'bottle_size_ml',
  'bottle_size_label',
  'is_non_standard_size',
  'quantity',
  'quantity_on_order',
  'unit_price',
  'currency',
  'body',
  'grapes',
  'drink_window_source',
  'sub_region',
].join(',');

const SCORE_COLUMNS =
  'id,vintage_id,source,source_detail,raw_value,value_low,value_high,is_plus,is_barrel_sample,scale_max,reviewed_on,drink_from,drink_to,url';

const NOTE_COLUMNS =
  'id,account_id,vintage_id,inventory_event_id,tasted_on,rating,maturity,notes,food_pairing,occasion,would_buy_again,created_at';

type Loaded = Omit<CellarData, 'bestScores' | 'reload' | 'palate' | 'accountId' | 'updatePalate'>;

/** Optional extras added with the palate profile: an older database just gives none. */
async function loadPalate(): Promise<Pick<Loaded, 'drinking' | 'palateSettings'>> {
  const [drinking, settings] = await Promise.all([
    fetchAll<VintageDrinking>('vintage_drinking', 'vintage_id,bought,drunk', 'vintage_id').catch(
      () => [] as VintageDrinking[],
    ),
    fetchAll<PalateSettings & { account_id: string }>(
      'palate_profiles',
      'account_id,quiz,not_really',
      'account_id',
    ).catch(() => []),
  ]);
  return { drinking, palateSettings: settings[0] ?? null };
}

/** Notes with the thumbs and source columns, or without them on an older database. */
async function loadNotes(): Promise<TastingNote[]> {
  try {
    return await fetchAll<TastingNote>('tasting_notes', `${NOTE_COLUMNS},liked,source`, 'id');
  } catch {
    return fetchAll<TastingNote>('tasting_notes', NOTE_COLUMNS, 'id');
  }
}

type Review = {
  vintage_id: string;
  maturity: Maturity | null;
  critics_say?: string | null;
  critics_url?: string | null;
  latest_note_year?: number | null;
};

/** Optional extra: an older database without the reviews table just gives empty maps. */
async function loadReviews(): Promise<Pick<Loaded, 'maturity' | 'critics'>> {
  let rows: Review[] = [];
  try {
    rows = await fetchAll<Review>(
      'vintage_assessments',
      'vintage_id,maturity,critics_say,critics_url,latest_note_year',
      'vintage_id',
    );
  } catch {
    try {
      rows = await fetchAll<Review>('vintage_assessments', 'vintage_id,maturity', 'vintage_id');
    } catch {
      rows = [];
    }
  }
  return {
    maturity: new Map(
      rows.filter((r) => r.maturity).map((r) => [r.vintage_id, r.maturity as Maturity]),
    ),
    critics: new Map(
      rows
        .filter((r) => r.critics_say)
        .map((r) => [
          r.vintage_id,
          {
            text: r.critics_say as string,
            url: r.critics_url ?? null,
            latestYear: r.latest_note_year ?? null,
          },
        ]),
    ),
  };
}

async function loadAll(): Promise<Loaded> {
  const [cellars, inventory, scores, accolades, notes, reviews, palate, labels, accounts] =
    await Promise.all([
      fetchAll<Cellar>('cellars', 'id,name,location,currency,sort_order', 'sort_order'),
      fetchAll<InventoryRow>('cellar_inventory', INVENTORY_COLUMNS, 'holding_id'),
      fetchAll<Score>('scores', SCORE_COLUMNS, 'id'),
      fetchAll<Accolade>('accolades', 'id,vintage_id,raw_text,publication,title,rank,year', 'id'),
      loadNotes(),
      loadReviews(),
      loadPalate(),
      loadLabels(),
      fetchAll<{ id: string; name: string }>('accounts', 'id,name', 'created_at'),
    ]);
  return {
    status: 'ready',
    error: null,
    cellars,
    inventory,
    scores,
    accolades,
    notes,
    ...reviews,
    ...palate,
    labels,
    account: accounts[0] ?? null,
  };
}

export function CellarDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Loaded>({
    status: 'loading',
    error: null,
    cellars: [],
    inventory: [],
    scores: [],
    accolades: [],
    notes: [],
    maturity: new Map(),
    critics: new Map(),
    labels: NO_LABELS,
    drinking: [],
    palateSettings: null,
    account: null,
  });

  const reload = useCallback(async () => {
    try {
      setState(await loadAll());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      // Keep showing what we had if a refresh fails; only the first load shows the error screen.
      setState((s) => (s.status === 'ready' ? s : { ...s, status: 'error', error: message }));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Once the cellar has loaded, quietly fill in missing wine facts (colour,
  // body, grapes, drinking windows) and refresh as they arrive. Runs once per
  // app start; when everything is filled in it is a single quick call.
  const loaded = state.status === 'ready';
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    fillInWines(() => !cancelled, reload);
    return () => {
      cancelled = true;
    };
  }, [loaded, reload]);

  const bestScores = useMemo(() => bestScoreByVintage(state.scores), [state.scores]);
  const palate = useMemo(
    () =>
      buildProfile({
        rows: state.inventory,
        drinking: state.drinking,
        notes: state.notes,
        quiz: state.palateSettings?.quiz,
        notReally: state.palateSettings?.not_really,
      }),
    [state.inventory, state.drinking, state.notes, state.palateSettings],
  );
  const accountId = state.account?.id ?? state.inventory[0]?.account_id ?? null;
  const updatePalate = useCallback(
    async (settings: PalateSettings) => {
      if (!accountId) throw new Error('Your cellar has not loaded yet.');
      let before: PalateSettings | null = null;
      setState((s) => {
        before = s.palateSettings;
        return { ...s, palateSettings: settings };
      });
      try {
        await savePalate(accountId, settings);
      } catch (e) {
        setState((s) => ({ ...s, palateSettings: before }));
        throw e;
      }
    },
    [accountId],
  );
  const retry = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    await reload();
  }, [reload]);

  return (
    <Ctx.Provider
      value={{
        ...state,
        bestScores,
        palate,
        accountId,
        updatePalate,
        reload: state.status === 'error' ? retry : reload,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCellarData(): CellarData {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCellarData must be used inside CellarDataProvider');
  return value;
}
