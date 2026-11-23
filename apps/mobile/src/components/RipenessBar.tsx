import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '../lib/theme';
import type { Ripeness } from '../logic/cellar';
import { T } from './ui';

const STATE_COLOR: Record<Ripeness['state'], string> = {
  unknown: colors.textFaint,
  young: colors.textMuted,
  ready: colors.accent,
  soon: colors.accent,
  past: colors.past,
};

/**
 * The drinking-window bar: the window is the filled part, the dot is this
 * year. Compact form (for list rows) is just the bar.
 */
export function RipenessBar({
  r,
  compact,
  estimate,
}: {
  r: Ripeness;
  compact?: boolean;
  /** The window was filled in automatically, not taken from a critic. */
  estimate?: boolean;
}) {
  const known = r.windowStart != null && r.windowEnd != null && r.marker != null;
  return (
    <View style={{ gap: space.sm }}>
      {!compact && (
        <T variant="bodyStrong" style={{ color: STATE_COLOR[r.state] }}>
          {r.label}
        </T>
      )}
      <View style={[styles.track, compact && styles.trackCompact]}>
        {known && (
          <>
            <View
              style={[
                styles.window,
                {
                  left: `${r.windowStart! * 100}%`,
                  width: `${(r.windowEnd! - r.windowStart!) * 100}%`,
                  backgroundColor: r.state === 'past' ? colors.past : colors.accent,
                  opacity: r.state === 'young' ? 0.35 : 0.85,
                },
              ]}
            />
            <View
              style={[
                compact ? styles.markerCompact : styles.marker,
                { left: `${r.marker! * 100}%` },
              ]}
            />
          </>
        )}
      </View>
      {!compact && known && (
        <View style={styles.captions}>
          <T variant="caption">{r.barFrom}</T>
          <T variant="caption">{r.barTo}</T>
        </View>
      )}
      {!compact && known && estimate && (
        <T variant="caption">Estimated window. Critic windows will replace it as they come in.</T>
      )}
      {!compact && !known && (
        <T variant="caption">No drinking window yet. It will be filled in shortly.</T>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'visible',
    justifyContent: 'center',
  },
  trackCompact: { height: 6, borderWidth: 0, backgroundColor: colors.border },
  window: { position: 'absolute', top: 0, bottom: 0, borderRadius: radius.pill },
  marker: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 3,
    borderColor: colors.text,
  },
  markerCompact: {
    position: 'absolute',
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: 5,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.background,
  },
  captions: { flexDirection: 'row', justifyContent: 'space-between' },
});
