import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, space } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { T } from './ui';

/** Holding screen for tabs that later stages build. */
export function ComingSoon({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center}>
        <View style={styles.badge}>
          <Icon name={icon} size={30} color={colors.accent} />
        </View>
        <T variant="heading">{title}</T>
        <T variant="caption" style={styles.text}>
          {text}
        </T>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.sm,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  text: { textAlign: 'center', maxWidth: 320 },
});
