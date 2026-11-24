import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { loadFoodMatch, makeFoodMatch, type FoodMatch } from '../data/foodMatches';
import { colors, fonts, radius, space } from '../lib/theme';
import { Icon } from './Icon';
import { Card, Placeholder, T } from './ui';

type State =
  | { state: 'loading' }
  | { state: 'making' }
  | { state: 'ready'; match: FoodMatch }
  | { state: 'none' };

/**
 * The Wine page's "Food matches": dishes that suit this wine, each with a
 * short reason. Tapping a dish opens Tonight with that dish asked, so the
 * owner sees which of their bottles suit it best. The "once mature" line
 * shows only when this bottle is in the mature part of its window.
 */
export function FoodMatches({ wineId, mature }: { wineId: string; mature: boolean }) {
  const [s, setS] = useState<State>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    setS({ state: 'loading' });
    (async () => {
      const saved = await loadFoodMatch(wineId);
      if (!live) return;
      if (saved) return setS({ state: 'ready', match: saved });
      setS({ state: 'making' });
      const made = await makeFoodMatch(wineId).catch(() => null);
      if (!live) return;
      setS(made ? { state: 'ready', match: made } : { state: 'none' });
    })();
    return () => {
      live = false;
    };
  }, [wineId]);

  if (s.state === 'loading' || s.state === 'making') {
    return (
      <View style={styles.waiting}>
        <ActivityIndicator color={colors.accent} />
        {s.state === 'making' ? <T variant="caption">Finding dishes for this wine…</T> : null}
      </View>
    );
  }
  if (s.state === 'none') {
    return <Placeholder text="Dishes that suit this wine will appear here." />;
  }

  const { dishes, avoid, older } = s.match;
  return (
    <View style={{ gap: space.sm }}>
      <Card style={{ paddingVertical: space.xs }}>
        {dishes.map((d, i) => (
          <Pressable
            key={d.dish}
            onPress={() => router.push({ pathname: '/', params: { ask: d.dish } })}
            accessibilityRole="button"
            accessibilityHint="Opens Tonight with this dish"
            style={({ pressed }) => [
              styles.row,
              i > 0 && styles.divider,
              pressed && { opacity: 0.6 },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="bodyStrong">{d.dish}</T>
              <T variant="caption">{d.why}</T>
            </View>
            <Icon name="chevron" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </Card>
      {mature && older ? (
        <View style={styles.note}>
          <T variant="caption" style={styles.noteText}>
            {older}
          </T>
        </View>
      ) : null}
      {avoid ? (
        <T variant="caption" style={{ paddingHorizontal: space.xs }}>
          {avoid}
        </T>
      ) : null}
      <T variant="caption" style={{ paddingHorizontal: space.xs, color: colors.textMuted }}>
        Tap a dish to see your best bottles for it.
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  note: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
  noteText: { color: colors.accent, fontFamily: fonts.medium },
});
