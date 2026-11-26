import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { createCellar } from '../data/account';
import { colors, fonts, radius, space } from '../lib/theme';
import { Button, Chip, T } from './ui';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF'] as const;

/**
 * Name, place and currency for a new cellar. Used for a new user's first
 * cellar and for "Add a cellar" on the My account page.
 */
export function CellarForm({
  accountId,
  sortOrder,
  submitLabel,
  onCreated,
}: {
  accountId: string | null;
  sortOrder: number;
  submitLabel: string;
  onCreated: () => Promise<void> | void;
}) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the cellar a name, such as Home.');
      return;
    }
    if (!accountId) {
      setError('Your account hasn’t loaded yet. Try again in a moment.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createCellar(accountId, { name, location, currency, sortOrder });
      setName('');
      setLocation('');
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.xs }}>
      <T variant="overline">Cellar name</T>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Home"
        placeholderTextColor={colors.textFaint}
        style={inputStyle.input}
        accessibilityLabel="Cellar name"
      />
      <T variant="overline" style={{ marginTop: space.md }}>
        Where is it? (optional)
      </T>
      <TextInput
        value={location}
        onChangeText={setLocation}
        placeholder="City or house"
        placeholderTextColor={colors.textFaint}
        style={inputStyle.input}
        accessibilityLabel="Where the cellar is"
      />
      <T variant="overline" style={{ marginTop: space.md }}>
        Prices in
      </T>
      <View style={styles.chips}>
        {CURRENCIES.map((c) => (
          <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
        ))}
      </View>
      {error ? (
        <T variant="caption" style={{ color: colors.danger, marginTop: space.sm }}>
          {error}
        </T>
      ) : null}
      <Button label={submitLabel} onPress={submit} loading={busy} style={{ marginTop: space.lg }} />
    </View>
  );
}

export const inputStyle = StyleSheet.create({
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

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
});
