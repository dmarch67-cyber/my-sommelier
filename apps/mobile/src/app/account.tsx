import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CellarForm, inputStyle } from '../components/CellarForm';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Button, T } from '../components/ui';
import { useCellarData } from '../data/CellarData';
import { amIAdmin, changeMyPassword, MIN_PASSWORD, updateMyName } from '../data/account';
import { useAuth } from '../lib/auth';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../lib/theme';

/** My account: your name and password, your cellars, sign out, and (for the admin) Users. */
export default function AccountScreen() {
  const { session, signOut } = useAuth();
  const data = useCellarData();
  const toast = useToast();
  const user = session?.user;
  const email = user?.email ?? '';

  const [admin, setAdmin] = useState(false);
  const [name, setName] = useState(String(user?.user_metadata?.full_name ?? ''));
  const [savingName, setSavingName] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [addingCellar, setAddingCellar] = useState(false);

  useEffect(() => {
    amIAdmin().then(setAdmin);
  }, []);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/cellar'));

  const saveName = async () => {
    setSavingName(true);
    try {
      await updateMyName(name);
      toast('Name saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    if (!current || !next) {
      setPasswordError('Enter your current password and a new one.');
      return;
    }
    setSavingPassword(true);
    setPasswordError(null);
    try {
      await changeMyPassword(email, current, next);
      setCurrent('');
      setNext('');
      toast('Password changed');
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPassword(false);
    }
  };

  const nameChanged = name.trim() !== String(user?.user_metadata?.full_name ?? '').trim();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={back} accessibilityRole="button" hitSlop={10} style={styles.backButton}>
          <Icon name="back" size={22} />
          <T variant="body">Back</T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <T variant="title">My account</T>

        {admin ? (
          <Pressable
            onPress={() => router.push('/admin')}
            accessibilityRole="button"
            accessibilityLabel="Users"
            style={({ pressed }) => [styles.adminCard, pressed && { opacity: 0.85 }]}
          >
            <View style={{ flex: 1, gap: space.xs }}>
              <T variant="overline" style={{ color: colors.accent }}>
                Admin
              </T>
              <T variant="body">Users: add people, change names, emails and passwords</T>
            </View>
            <Icon name="chevron" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}

        <View style={styles.block}>
          <T variant="heading">Your details</T>
          <T variant="overline" style={{ marginTop: space.sm }}>
            Name
          </T>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textFaint}
            style={inputStyle.input}
            accessibilityLabel="Your name"
          />
          {nameChanged ? (
            <Button
              label="Save name"
              onPress={saveName}
              loading={savingName}
              style={{ marginTop: space.sm }}
            />
          ) : null}
          <T variant="overline" style={{ marginTop: space.md }}>
            Sign-in email
          </T>
          <T variant="body">{email}</T>
          <T variant="caption">
            {admin
              ? 'You can change it on the Users screen.'
              : 'To change the email you sign in with, ask the person who invited you.'}
          </T>
        </View>

        <View style={styles.block}>
          <T variant="heading">Change password</T>
          <T variant="overline" style={{ marginTop: space.sm }}>
            Current password
          </T>
          <TextInput
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            style={inputStyle.input}
            accessibilityLabel="Current password"
          />
          <T variant="overline" style={{ marginTop: space.md }}>
            New password
          </T>
          <TextInput
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            style={inputStyle.input}
            accessibilityLabel="New password"
          />
          <T variant="caption">At least {MIN_PASSWORD} characters.</T>
          {passwordError ? (
            <T variant="caption" style={{ color: colors.danger }}>
              {passwordError}
            </T>
          ) : null}
          <Button
            label="Change password"
            onPress={savePassword}
            loading={savingPassword}
            style={{ marginTop: space.sm }}
          />
        </View>

        <View style={styles.block}>
          <T variant="heading">Your cellars</T>
          {data.cellars.map((c) => (
            <T key={c.id} variant="body">
              {c.name}
              {c.location ? <T variant="caption"> · {c.location}</T> : null}
              <T variant="caption"> · {c.currency}</T>
            </T>
          ))}
          {addingCellar ? (
            <View style={{ marginTop: space.md }}>
              <CellarForm
                accountId={data.accountId}
                sortOrder={data.cellars.length}
                submitLabel="Add cellar"
                onCreated={async () => {
                  await data.reload();
                  setAddingCellar(false);
                  toast('Cellar added');
                }}
              />
            </View>
          ) : (
            <Button
              label="Add a cellar"
              kind="secondary"
              onPress={() => setAddingCellar(true)}
              style={{ marginTop: space.sm }}
            />
          )}
        </View>

        <Button label="Sign out" kind="secondary" onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', padding: space.sm },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: space.sm,
    alignSelf: 'flex-start',
  },
  scroll: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    padding: space.lg,
    paddingBottom: 64,
    gap: space.xl,
  },
  block: { gap: space.xs },
  adminCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: space.lg,
  },
});
