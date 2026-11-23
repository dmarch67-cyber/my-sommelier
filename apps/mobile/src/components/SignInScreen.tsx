import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../lib/auth';
import { colors, fonts, radius, space } from '../lib/theme';
import { Icon } from './Icon';
import { Button, T } from './ui';

export function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    const problem = await signIn(email, password);
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            <View style={styles.logo}>
              <Icon name="glass" size={34} color={colors.onAccent} strokeWidth={1.6} />
            </View>
            <T variant="title" style={{ textAlign: 'center' }}>
              My Sommelier
            </T>
            <T variant="caption" style={{ textAlign: 'center', marginBottom: space.xl }}>
              Sign in to see your cellar.
            </T>

            <T variant="overline">Email</T>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Email"
            />
            <T variant="overline" style={{ marginTop: space.lg }}>
              Password
            </T>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              style={styles.input}
              onSubmitEditing={submit}
              returnKeyType="go"
              accessibilityLabel="Password"
            />
            {error ? (
              <T variant="caption" style={{ color: colors.danger, marginTop: space.md }}>
                {error}
              </T>
            ) : null}
            <Button
              label="Sign in"
              onPress={submit}
              loading={busy}
              style={{ marginTop: space.xl }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 50,
    marginTop: space.xs,
  },
});
