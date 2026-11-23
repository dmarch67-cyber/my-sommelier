import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../../components/Icon';
import { T } from '../../components/ui';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../../lib/theme';

export default function AddScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <T variant="title">Add bottles</T>
        <T variant="caption" style={{ marginBottom: space.lg }}>
          Everything you add can be undone straight after.
        </T>
        <Option
          icon="camera"
          title="Snap the label"
          text="Take a photo of the label and the app fills in the wine for you to check."
          onPress={() => router.push('/add/label')}
        />
        <Option
          icon="mic"
          title="Type it or say it"
          text="“Six bottles of 2019 Ridge Monte Bello”. Finds wines you already have, or adds a new one."
          onPress={() => router.push('/add/manual')}
        />
        <Option
          icon="note"
          title="Upload a delivery spreadsheet"
          text="Excel or CSV from a merchant. You check the list before anything is added. It only adds, never replaces."
          onPress={() => router.push('/add/upload')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Option({
  icon,
  title,
  text,
  onPress,
}: {
  icon: IconName;
  title: string;
  text: string;
  onPress?: () => void;
}) {
  const disabled = !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.option,
        pressed && { backgroundColor: colors.border },
        disabled && { opacity: 0.55 },
      ]}
    >
      <View style={styles.badge}>
        <Icon name={icon} size={24} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="heading">{title}</T>
        <T variant="caption">{text}</T>
      </View>
      {!disabled && <Icon name="chevron" size={20} color={colors.textMuted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    padding: space.lg,
    gap: space.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    minHeight: 88,
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
