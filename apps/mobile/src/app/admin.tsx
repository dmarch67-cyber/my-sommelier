import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { inputStyle } from '../components/CellarForm';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { SwitchRow } from '../components/controls';
import { Button, T } from '../components/ui';
import {
  amIAdmin,
  createUser,
  listUsers,
  MIN_PASSWORD,
  setResearch,
  updateUser,
  type AdminUser,
} from '../data/account';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { formatDay } from '../lib/format';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../lib/theme';

/**
 * Users (admin only): everyone who can sign in. Add a person with a starting
 * password, and change anyone's name, email or password, your own included.
 * Nobody's cellar is visible here, only their sign-in and how big it is.
 */
export default function AdminScreen() {
  const toast = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    amIAdmin().then((ok) => {
      setAllowed(ok);
      if (ok) load();
    });
  }, [load]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/account'));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={back} accessibilityRole="button" hitSlop={10} style={styles.backButton}>
          <Icon name="back" size={22} />
          <T variant="body">Back</T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <T variant="title">Users</T>
        {allowed === false ? (
          <T variant="body">Only the admin can open this page.</T>
        ) : allowed === null || (users === null && !error) ? (
          <ActivityIndicator color={colors.accent} />
        ) : error ? (
          <View style={{ gap: space.md }}>
            <T variant="body">Couldn’t load the users: {error}</T>
            <Button label="Try again" onPress={load} />
          </View>
        ) : (
          <>
            {adding ? (
              <AddPerson
                onDone={async (added) => {
                  setAdding(false);
                  if (added) {
                    toast('Person added');
                    await load();
                  }
                }}
              />
            ) : (
              <Button label="Add a person" onPress={() => setAdding(true)} />
            )}
            <T variant="caption">
              {users!.length} {users!.length === 1 ? 'person' : 'people'} can sign in. Tap someone
              to change their details.
            </T>
            <View style={{ gap: space.sm }}>
              {users!.map((u) => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  open={open === u.user_id}
                  onToggle={() => setOpen(open === u.user_id ? null : u.user_id)}
                  onSaved={async (what) => {
                    toast(what);
                    await load();
                  }}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AddPerson({ onDone }: { onDone: (added: boolean) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter their email and a starting password.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Use a longer password (at least ${MIN_PASSWORD} characters).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createUser({ name: name.trim(), email: email.trim(), password });
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <T variant="heading">Add a person</T>
      <T variant="caption">
        They get their own empty account, private from yours. Tell them their email and this
        starting password; they can change the password in My account.
      </T>
      <Field label="Name" value={name} onChange={setName} placeholder="Their name" />
      <Field label="Email" value={email} onChange={setEmail} placeholder="name@example.com" email />
      <Field
        label="Starting password"
        value={password}
        onChange={setPassword}
        placeholder={`At least ${MIN_PASSWORD} characters`}
        password
      />
      {error ? (
        <T variant="caption" style={{ color: colors.danger }}>
          {error}
        </T>
      ) : null}
      <View style={styles.buttons}>
        <Button label="Add person" onPress={submit} loading={busy} style={{ flex: 1 }} />
        <Button label="Cancel" kind="secondary" onPress={() => onDone(false)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function UserRow({
  user,
  open,
  onToggle,
  onSaved,
}: {
  user: AdminUser;
  open: boolean;
  onToggle: () => void;
  onSaved: (what: string) => Promise<void>;
}) {
  const { session } = useAuth();
  const isMe = session?.user.id === user.user_id;
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [research, setResearchOn] = useState(user.research_enabled);

  useEffect(() => {
    if (!open) {
      setName(user.name);
      setEmail(user.email);
      setPassword('');
      setError(null);
    }
  }, [open, user.name, user.email]);
  useEffect(() => setResearchOn(user.research_enabled), [user.research_enabled]);

  const save = async () => {
    const changes: { name?: string; email?: string; password?: string } = {};
    if (name.trim() !== user.name) changes.name = name.trim();
    if (email.trim().toLowerCase() !== user.email.toLowerCase()) changes.email = email.trim();
    if (password) changes.password = password;
    if (Object.keys(changes).length === 0) {
      setError('Nothing has changed.');
      return;
    }
    if (password && password.length < MIN_PASSWORD) {
      setError(`Use a longer password (at least ${MIN_PASSWORD} characters).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateUser(user.user_id, changes);
      // Your own new email or name shows straight away after a refresh.
      if (isMe) await supabase.auth.refreshSession().catch(() => undefined);
      setPassword('');
      await onSaved(
        changes.password && Object.keys(changes).length === 1 ? 'Password changed' : 'Saved',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchResearch = async (on: boolean) => {
    if (!user.account_id) return;
    setResearchOn(on);
    try {
      await setResearch(user.account_id, on);
      await onSaved(on ? 'Research switched on' : 'Research switched off');
    } catch (e) {
      setResearchOn(!on);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const summary = [
    user.cellars === 1 ? '1 cellar' : `${user.cellars} cellars`,
    `${user.bottles.toLocaleString()} bottles`,
    user.last_sign_in_at
      ? `last signed in ${formatDay(user.last_sign_in_at.slice(0, 10))}`
      : 'not signed in yet',
  ].join(' · ');

  return (
    <View style={[styles.card, !open && styles.cardClosed]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.rowHead}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="bodyStrong">
            {user.name || user.email}
            {isMe ? <T variant="caption"> (you)</T> : null}
            {user.is_admin ? <T variant="caption"> · admin</T> : null}
          </T>
          {user.name ? <T variant="caption">{user.email}</T> : null}
          <T variant="caption">{summary}</T>
        </View>
        <Icon name="chevron" size={20} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <View style={{ gap: space.xs }}>
          <Field label="Name" value={name} onChange={setName} placeholder="Their name" />
          <Field label="Sign-in email" value={email} onChange={setEmail} email />
          <Field
            label="New password"
            value={password}
            onChange={setPassword}
            placeholder="Leave blank to keep the current one"
            password
          />
          {error ? (
            <T variant="caption" style={{ color: colors.danger }}>
              {error}
            </T>
          ) : null}
          <Button
            label="Save changes"
            onPress={save}
            loading={busy}
            style={{ marginTop: space.sm }}
          />
          {user.account_id ? (
            <View style={{ marginTop: space.md }}>
              <SwitchRow
                label="Background research"
                caption="Drinking windows, critic notes and label pictures for their wines. Uses AI credit."
                value={research}
                onChange={switchResearch}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  email,
  password,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  email?: boolean;
  password?: boolean;
}) {
  return (
    <View style={{ marginTop: space.sm }}>
      <T variant="overline">{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoCapitalize={email || password ? 'none' : 'words'}
        autoCorrect={false}
        keyboardType={email ? 'email-address' : 'default'}
        secureTextEntry={password}
        autoComplete={password ? 'new-password' : 'off'}
        style={[inputStyle.input, { backgroundColor: colors.background }]}
        accessibilityLabel={label}
      />
    </View>
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
    gap: space.lg,
  },
  card: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  cardClosed: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
});
