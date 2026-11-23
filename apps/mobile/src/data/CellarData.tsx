import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { supabase } from '../lib/supabase';
import {
  bestScoreByVintage,
  type Accolade,
  type Cellar,
  type InventoryRow,
  type Score,
} from '../logic/cellar';

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
  bestScores: Map<string, Score>;
  reload: () => void;
};

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
].join(',');

const SCORE_COLUMNS =
  'id,vintage_id,source,source_detail,raw_value,value_low,value_high,is_plus,is_barrel_sample,scale_max,reviewed_on,drink_from,drink_to,url';

export function CellarDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<CellarData, 'bestScores' | 'reload'>>({
    status: 'loading',
    error: null,
    cellars: [],
    inventory: [],
    scores: [],
    accolades: [],
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    Promise.all([
      fetchAll<Cellar>('cellars', 'id,name,location,currency,sort_order', 'sort_order'),
      fetchAll<InventoryRow>('cellar_inventory', INVENTORY_COLUMNS, 'holding_id'),
      fetchAll<Score>('scores', SCORE_COLUMNS, 'id'),
      fetchAll<Accolade>('accolades', 'id,vintage_id,raw_text,publication,title,rank,year', 'id'),
    ])
      .then(([cellars, inventory, scores, accolades]) => {
        if (cancelled) return;
        setState({ status: 'ready', error: null, cellars, inventory, scores, accolades });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const bestScores = useMemo(() => bestScoreByVintage(state.scores), [state.scores]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return <Ctx.Provider value={{ ...state, bestScores, reload }}>{children}</Ctx.Provider>;
}

export function useCellarData(): CellarData {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCellarData must be used inside CellarDataProvider');
  return value;
}
