import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { recheckWindow, type RecheckResult } from '../data/recheck';
import { colors, fonts, space } from '../lib/theme';
import { T } from './ui';

type State =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; result: RecheckResult }
  | { state: 'failed'; message: string };

function span(from: number | null, to: number | null): string {
  if (from == null || to == null) return 'none';
  return from === to ? String(from) : `${from}–${to}`;
}

/**
 * Under the drinking window: "Recheck window". Looks the vintage up again
 * (critic reviews, recent notes), saves the new window and says why. A window
 * the owner typed in is never replaced.
 */
export function RecheckWindow({ vintageId, onSaved }: { vintageId: string; onSaved: () => void }) {
  const [s, setS] = useState<State>({ state: 'idle' });

  const run = async () => {
    setS({ state: 'checking' });
    try {
      const result = await recheckWindow(vintageId);
      setS({ state: 'done', result });
      if (!result.kept_owner) onSaved();
    } catch (e) {
      setS({ state: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (s.state === 'checking') {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={colors.accent} />
        <T variant="caption">Reading critic reviews and recent notes… about a minute.</T>
      </View>
    );
  }

  if (s.state === 'done') {
    const { before, after, why, kept_owner, sources } = s.result;
    const same = before.drink_from === after.drink_from && before.drink_to === after.drink_to;
    const headline = kept_owner
      ? `Suggested ${span(after.drink_from, after.drink_to)}. Your own window is kept.`
      : same
        ? `Window confirmed: ${span(after.drink_from, after.drink_to)}.`
        : `New window ${span(after.drink_from, after.drink_to)} (was ${span(before.drink_from, before.drink_to)}).`;
    return (
      <View style={styles.result}>
        <T variant="bodyStrong">{headline}</T>
        {why ? <T variant="body">{why}</T> : null}
        {sources.length > 0 && (
          <View style={{ gap: 2 }}>
            {[...new Map(sources.map((x) => [x.url, x])).values()].slice(0, 3).map((src) => (
              <Pressable
                key={src.url}
                onPress={() => Linking.openURL(src.url)}
                accessibilityRole="link"
              >
                <T variant="caption" style={styles.link} numberOfLines={1}>
                  {src.title || src.url}
                </T>
              </Pressable>
            ))}
          </View>
        )}
        <Pressable onPress={run} accessibilityRole="button" hitSlop={6}>
          <T variant="caption" style={styles.action}>
            Recheck again
          </T>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable onPress={run} accessibilityRole="button" hitSlop={6}>
        <T variant="caption" style={styles.action}>
          Recheck window
        </T>
      </Pressable>
      {s.state === 'failed' ? (
        <T variant="caption" style={{ flex: 1 }}>
          {s.message}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  result: {
    gap: space.sm,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  action: { color: colors.accent, fontFamily: fonts.semibold },
  link: { color: colors.accent, textDecorationLine: 'underline' },
});
