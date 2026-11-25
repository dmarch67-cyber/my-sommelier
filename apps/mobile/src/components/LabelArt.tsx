import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useCellarData } from '../data/CellarData';
import { labelFor } from '../data/labels';
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
 * The wine's label picture: the owner's own photo or one found online. Wines
 * without one (or whose picture fails to load) show a monogram tile instead.
 */
export function LabelArt({
  name,
  vintage,
  colour,
  size = 'small',
  wineId,
  vintageId,
  uri: given,
}: {
  name: string;
  vintage: number | null;
  colour: string | null;
  size?: 'small' | 'large';
  /** The wine and vintage whose saved picture to show (the vintage's own label first). */
  wineId?: string;
  vintageId?: string;
  /** A picture to show instead (e.g. a photo just taken). */
  uri?: string | null;
}) {
  const labels = useCellarData().labels;
  const uri = given ?? labelFor(labels, wineId, vintageId)?.uri ?? null;
  const tint = TINTS[colour ?? 'red'] ?? TINTS.red;
  const large = size === 'large';
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [uri]);
  if (uri && !broken) {
    return (
      <View
        style={[large ? styles.large : styles.small, styles.photoFrame]}
        accessibilityLabel={large ? `Label of ${name}` : undefined}
      >
        <Image
          source={{ uri }}
          style={styles.photo}
          resizeMode="contain"
          onError={() => setBroken(true)}
        />
      </View>
    );
  }
  return (
    <View
      style={[large ? styles.large : styles.small, { backgroundColor: tint.bg }]}
      accessibilityLabel={large ? 'No label picture yet' : undefined}
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
  photoFrame: { backgroundColor: '#FFFFFF', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  mono: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: 1 },
  year: { fontFamily: fonts.medium, fontSize: 10, marginTop: 2, opacity: 0.8 },
  monoLarge: { fontFamily: fonts.semibold, fontSize: 38, letterSpacing: 2 },
  yearLarge: { fontFamily: fonts.medium, fontSize: 15, opacity: 0.8 },
});
