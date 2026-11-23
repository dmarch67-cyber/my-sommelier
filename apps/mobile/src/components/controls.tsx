import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, fonts, radius, space } from '../lib/theme';
import { T } from './ui';

/** Five tappable stars. Tapping the current value again clears it. */
export function Stars({
  value,
  onChange,
  size = 36,
}: {
  value: number | null;
  onChange?: (stars: number | null) => void;
  size?: number;
}) {
  return (
    <View style={styles.stars} accessibilityRole={onChange ? 'adjustable' : 'text'}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        const star = (
          <Text
            style={{
              fontSize: size,
              lineHeight: size * 1.15,
              color: on ? colors.accent : colors.border,
            }}
          >
            ★
          </Text>
        );
        if (!onChange) return <View key={n}>{star}</View>;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(value === n ? null : n)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
            accessibilityState={{ selected: on }}
          >
            {star}
          </Pressable>
        );
      })}
    </View>
  );
}

/** − 6 + */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 999,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={styles.stepButton}
        accessibilityRole="button"
        accessibilityLabel="One fewer"
        disabled={value <= min}
      >
        <Text style={[styles.stepText, value <= min && { color: colors.textFaint }]}>−</Text>
      </Pressable>
      <Text style={styles.stepValue} accessibilityLabel={`${value}`}>
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        style={styles.stepButton}
        accessibilityRole="button"
        accessibilityLabel="One more"
      >
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

export function SwitchRow({
  label,
  caption,
  value,
  onChange,
}: {
  label: string;
  caption?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={styles.switchRow}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong">{label}</T>
        {caption ? <T variant="caption">{caption}</T> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={colors.background}
        {...({ activeThumbColor: colors.background } as object)}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: 'row', gap: space.xs },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    alignSelf: 'flex-start',
  },
  stepButton: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: fonts.medium, fontSize: 24, color: colors.accent },
  stepValue: {
    fontFamily: fonts.bold,
    fontSize: 20,
    minWidth: 40,
    textAlign: 'center',
    color: colors.text,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
  },
});
