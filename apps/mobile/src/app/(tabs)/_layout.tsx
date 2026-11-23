import { Tabs } from 'expo-router/js-tabs';
import { Platform } from 'react-native';

import { Icon, type IconName } from '../../components/Icon';
import { colors, fonts } from '../../lib/theme';

const icon =
  (name: IconName) =>
  ({ color }: { color: unknown }) => <Icon name={name} color={String(color)} size={24} />;

export const unstable_settings = { initialRouteName: 'index' };

/**
 * Bottom tabs from the design brief: Tonight, Cellar, Add, Notes.
 * Stage 1 builds Cellar (and the Wine page), so the app opens on Cellar for
 * now; Tonight becomes the home screen once it is built.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
        tabBarStyle: {
          borderTopColor: colors.border,
          backgroundColor: colors.background,
          // Phones add their own safe-area padding; the web needs a little room.
          ...(Platform.OS === 'web' ? { height: 68, paddingTop: 6, paddingBottom: 10 } : null),
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="tonight" options={{ title: 'Tonight', tabBarIcon: icon('glass') }} />
      <Tabs.Screen name="index" options={{ title: 'Cellar', tabBarIcon: icon('cellar') }} />
      <Tabs.Screen name="add" options={{ title: 'Add', tabBarIcon: icon('plus') }} />
      <Tabs.Screen name="notes" options={{ title: 'Notes', tabBarIcon: icon('note') }} />
    </Tabs>
  );
}
