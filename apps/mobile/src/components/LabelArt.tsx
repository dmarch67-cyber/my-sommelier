import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius } from '../lib/theme';

const TINTS: Record<string, { bg: string; fg: string }> = {
  red: { bg: '#F3E6EA', fg: colors.accent },
  white: { bg: '#F6F1E2', fg: '#7A6A2E' },
  rose: { bg: '#FBEAEA', fg: '#A2485A' },
  sparkling: { bg: '#F1F1EA', fg: '#6E6A4A' },
};

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-Z]/.test(w));
  return (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
}

/**
 * Stand-in for the wine's label picture. Real label images (from Vinous or
 * CellarTracker, else Dan's photo) replace this in a later build.
 */
export function LabelArt({
  name,
  vintage,
  colour,
  size = 'small',
}: {
  name: string;
  vintage: number | null;
  colour: string | null;
  size?: 'small' | 'large';
}) {
  const tint = TINTS[colour ?? 'red'] ?? TINTS.red;
  const large = size === 'large';
  return (
    <View
      style={[large ? styles.large : styles.small, { backgroundColor: tint.bg }]}
      accessibilityLabel={large ? 'Label picture coming soon' : undefined}
    >
      <Text style={[large ? styles.monoLarge : styles.mono, { color: tint.fg }]}>
        {initials(name).toUpperCase()}
      </Text>
      <Text style={[large ? styles.yearLarge : styles.year, { color: tint.fg }]}>
        {vintage ?? 'NV'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  small: {
    width: 48,
    height: 64,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    width: 132,
    height: 176,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mono: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: 1 },
  year: { fontFamily: fonts.medium, fontSize: 10, marginTop: 2, opacity: 0.8 },
  monoLarge: { fontFamily: fonts.semibold, fontSize: 38, letterSpacing: 2 },
  yearLarge: { fontFamily: fonts.medium, fontSize: 15, opacity: 0.8 },
});
