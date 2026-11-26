import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCellarData } from '../data/CellarData';
import { useAuth } from '../lib/auth';
import { colors, space } from '../lib/theme';
import { CellarForm } from './CellarForm';
import { Icon } from './Icon';
import { T } from './ui';

/** A new user with no cellar yet: make the first one, then the app opens as usual. */
export function FirstCellarScreen() {
  const data = useCellarData();
  const { session, signOut } = useAuth();
  const name = String(session?.user.user_metadata?.full_name ?? '').split(' ')[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <View style={styles.logo}>
            <Icon name="glass" size={34} color={colors.onAccent} strokeWidth={1.6} />
          </View>
          <T variant="title" style={{ textAlign: 'center' }}>
            {name ? `Welcome, ${name}` : 'Welcome'}
          </T>
          <T variant="body" style={{ textAlign: 'center', marginBottom: space.xl }}>
            First, name your cellar. If you keep wine in more than one place, start with one; you
            can add the others from My account. Then add bottles by snapping labels, typing them in,
            or uploading a spreadsheet.
          </T>
          <CellarForm
            accountId={data.accountId}
            sortOrder={0}
            submitLabel="Create my cellar"
            onCreated={data.reload}
          />
          <Pressable
            onPress={signOut}
            accessibilityRole="button"
            hitSlop={10}
            style={{ alignSelf: 'center', marginTop: space.xl }}
          >
            <T variant="caption">Sign out</T>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: space.xl },
  column: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: space.xs },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.lg,
  },
});
