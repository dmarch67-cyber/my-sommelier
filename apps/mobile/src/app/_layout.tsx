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

import { FirstCellarScreen } from '../components/FirstCellarScreen';
import { SignInScreen } from '../components/SignInScreen';
import { ToastProvider } from '../components/Toast';
import { CellarDataProvider, useCellarData } from '../data/CellarData';
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

/** Signed out: the sign-in screen. Signed in: the app, with the user's cellars loaded. */
function Gate() {
  const { session } = useAuth();
  if (session === undefined) return <Loading />;
  if (!session) return <SignInScreen />;
  return (
    <CellarDataProvider key={session.user.id}>
      <ToastProvider>
        <NeedsCellar />
      </ToastProvider>
    </CellarDataProvider>
  );
}

/** A new user with no cellars yet makes their first one before anything else. */
function NeedsCellar() {
  const data = useCellarData();
  if (data.status === 'ready' && data.cellars.length === 0) return <FirstCellarScreen />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
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
