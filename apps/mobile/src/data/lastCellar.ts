import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { ALL_CELLARS, type CellarFilter } from '../logic/cellar';

const KEY = 'my-sommelier:last-cellar';

/**
 * The cellar Dan last looked at (a cellar id, or "all"). The app opens on it
 * next time, as the design brief asks. Stored on this device only.
 */
export function useLastCellar(validIds: string[]) {
  const [filter, setFilter] = useState<CellarFilter | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => setFilter(saved ?? ALL_CELLARS))
      .catch(() => setFilter(ALL_CELLARS));
  }, []);

  const choose = useCallback((next: CellarFilter) => {
    setFilter(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  // A saved cellar that no longer exists falls back to All.
  const valid =
    filter === null || filter === ALL_CELLARS || validIds.length === 0 || validIds.includes(filter)
      ? filter
      : ALL_CELLARS;

  return [valid, choose] as const;
}
