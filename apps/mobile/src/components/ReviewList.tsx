import { Pressable, StyleSheet, View } from 'react-native';

import { colors, fonts, radius, space } from '../lib/theme';
import { formatPrice } from '../logic/cellar';
import type { ReviewLine } from '../logic/review';
import { T } from './ui';

/** The lines to check before adding: tick or untick, and fix which wine each one is. */
export function ReviewList({
  lines,
  currency,
  onChange,
}: {
  lines: ReviewLine[];
  /** The chosen cellar's currency, for lines without their own. */
  currency: string | null;
  onChange: (index: number, patch: Partial<ReviewLine>) => void;
}) {
  return (
    <View style={styles.list}>
      {lines.map((l, i) => {
        const cur = l.currency ?? currency;
        return (
          <View key={l.key} style={[styles.line, !l.include && { opacity: 0.45 }]}>
            <Pressable
              onPress={() => onChange(i, { include: !l.include })}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: l.include }}
              hitSlop={8}
              style={[styles.check, l.include && styles.checkOn]}
            >
              {l.include ? <T style={styles.checkMark}>✓</T> : null}
            </Pressable>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="bodyStrong">
                {l.match?.name ?? l.wineName} {l.vintage ?? 'NV'}
              </T>
              <T variant="caption">
                {[
                  `${l.quantity} × ${l.sizeMl === 750 ? 'bottle' : l.sizeMl === 1500 ? 'magnum' : `${l.sizeMl} ml`}`,
                  l.unitPrice != null && cur ? `${formatPrice(l.unitPrice, cur)} each` : null,
                  l.score ? `score ${l.score.raw}` : null,
                  l.where,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </T>
              {l.note ? (
                <T variant="caption" style={{ color: colors.danger }}>
                  {l.note}
                </T>
              ) : null}
              {l.match ? (
                <View style={styles.tagRow}>
                  <T variant="caption" style={styles.tagIn}>
                    In your cellar
                  </T>
                  {l.match.name !== l.wineName && (
                    <Pressable onPress={() => onChange(i, { match: null })} hitSlop={6}>
                      <T variant="caption" style={{ color: colors.accent }}>
                        Not this wine
                      </T>
                    </Pressable>
                  )}
                </View>
              ) : (
                <View style={styles.tagRow}>
                  <T variant="caption" style={styles.tagNew}>
                    New wine
                  </T>
                  {l.suggestion && (
                    <Pressable onPress={() => onChange(i, { match: l.suggestion })} hitSlop={6}>
                      <T variant="caption" style={{ color: colors.accent }}>
                        Same as “{l.suggestion.name}”?
                      </T>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  line: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: colors.onAccent, fontFamily: fonts.bold, fontSize: 14, lineHeight: 16 },
  tagRow: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginTop: 2 },
  tagIn: { color: colors.textMuted },
  tagNew: {
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    overflow: 'hidden',
  },
});
