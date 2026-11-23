import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { SignInScreen } from '../components/SignInScreen';
import { CellarDataProvider } from '../data/CellarData';
import { AuthProvider, useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  if (!fontsLoaded) return <Loading />;
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Gate />
    </AuthProvider>
  );
}

/** Signed out: the sign-in screen. Signed in: the app, with Dan's cellar loaded. */
function Gate() {
  const { session } = useAuth();
  if (session === undefined) return <Loading />;
  if (!session) return <SignInScreen />;
  return (
    <CellarDataProvider key={session.user.id}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </CellarDataProvider>
  );
}

function Loading() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
      }}
    >
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
