import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { ALL_CELLARS, type CellarFilter } from '../logic/cellar';

const KEY = 'my-sommelier:last-cellar';

// Tonight and Cellar stay open side by side (tabs), so a change on one must
// show on the other: every screen using the hook shares this one value.
let current: CellarFilter | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(f: CellarFilter) => void>();

function load(): Promise<void> {
  loading ??= AsyncStorage.getItem(KEY)
    .then((saved) => {
      current ??= saved ?? ALL_CELLARS;
    })
    .catch(() => {
      current ??= ALL_CELLARS;
    });
  return loading;
}

/**
 * The cellar Dan last looked at (a cellar id, or "all"). The app opens on it
 * next time, as the design brief asks. Stored on this device only.
 */
export function useLastCellar(validIds: string[]) {
  const [filter, setFilter] = useState<CellarFilter | null>(current);

  useEffect(() => {
    listeners.add(setFilter);
    load().then(() => setFilter(current));
    return () => {
      listeners.delete(setFilter);
    };
  }, []);

  const choose = useCallback((next: CellarFilter) => {
    current = next;
    for (const l of listeners) l(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  // A saved cellar that no longer exists falls back to All.
  const valid =
    filter === null || filter === ALL_CELLARS || validIds.length === 0 || validIds.includes(filter)
      ? filter
      : ALL_CELLARS;

  return [valid, choose] as const;
}
