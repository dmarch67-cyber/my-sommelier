import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Stars } from '../components/controls';
import { useToast } from '../components/Toast';
import { Button, Chip, T } from '../components/ui';
import { VoiceField } from '../components/VoiceField';
import { useCellarData } from '../data/CellarData';
import { deleteNote, updateNote } from '../data/writes';
import { formatDay } from '../lib/format';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../lib/theme';
import type { Maturity } from '../logic/cellar';

const MATURITY: { key: Maturity; label: string }[] = [
  { key: 'too_young', label: 'Too young' },
  { key: 'approaching', label: 'Nearly there' },
  { key: 'ready', label: 'Ready' },
  { key: 'peak', label: 'At its peak' },
  { key: 'declining', label: 'Fading' },
  { key: 'past_it', label: 'Past it' },
];

/**
 * Edit or delete one of your own tasting notes (opened from the Notes page).
 * Only notes in your own account are listed there, and the database only
 * lets you change your own; critics' and other drinkers' notes live
 * elsewhere and are never shown here.
 */
export default function NoteEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useCellarData();
  const toast = useToast();
  const note = data.notes.find((n) => n.id === id);
  const wine = note ? data.inventory.find((r) => r.vintage_id === note.vintage_id) : undefined;

  const startStars = note?.rating ? Math.round(note.rating / 20) : null;
  const [liked, setLiked] = useState<boolean | null>(note?.liked ?? null);
  const [stars, setStars] = useState<number | null>(startStars);
  const [text, setText] = useState(note?.notes ?? '');
  const [maturity, setMaturity] = useState<Maturity | null>(note?.maturity ?? null);
  const [food, setFood] = useState(note?.food_pairing ?? '');
  const [occasion, setOccasion] = useState(note?.occasion ?? '');
  const [buyAgain, setBuyAgain] = useState<boolean | null>(note?.would_buy_again ?? null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [askDelete, setAskDelete] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/notes'));

  if (!note) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar onBack={back} />
        <View style={styles.scroll}>
          <T variant="body">
            {data.status === 'ready' ? 'This note is no longer there.' : 'Loading…'}
          </T>
        </View>
      </SafeAreaView>
    );
  }

  const fromCT = note.source === 'cellartracker';
  const clean = (s: string) => s.trim() || null;
  const patch = {
    ...(stars !== startStars ? { rating: stars ? stars * 20 : null } : {}),
    ...(liked !== (note.liked ?? null) ? { liked } : {}),
    ...(clean(text) !== (note.notes ?? null) ? { notes: clean(text) } : {}),
    ...(maturity !== note.maturity ? { maturity } : {}),
    ...(clean(food) !== (note.food_pairing ?? null) ? { food_pairing: clean(food) } : {}),
    ...(clean(occasion) !== (note.occasion ?? null) ? { occasion: clean(occasion) } : {}),
    ...(buyAgain !== note.would_buy_again ? { would_buy_again: buyAgain } : {}),
  };
  const changed = Object.keys(patch).length > 0;

  const save = async () => {
    if (!changed) return back();
    setBusy('save');
    try {
      await updateNote(note.id, patch, fromCT);
      await data.reload();
      toast('Note saved.');
      back();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await deleteNote(note.id);
      await data.reload();
      toast('Note deleted.');
      back();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar onBack={back} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <T variant="overline" style={{ color: colors.accent }}>
          Edit note
        </T>
        <T variant="title">{wine ? `${wine.wine_name} ${wine.vintage ?? 'NV'}` : 'Wine'}</T>
        <T variant="caption">
          {[
            note.tasted_on ? `Tasted ${formatDay(note.tasted_on)}` : null,
            fromCT ? 'From your CellarTracker notes' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>

        <View style={styles.section}>
          <T variant="heading">Did you enjoy it?</T>
          <View style={styles.thumbs}>
            {[
              { v: true, label: '👍  Yes', a11y: 'Thumbs up' },
              { v: false, label: '👎  Not really', a11y: 'Thumbs down' },
            ].map((o) => {
              const selected = liked === o.v;
              return (
                <Pressable
                  key={String(o.v)}
                  onPress={() => setLiked(selected ? null : o.v)}
                  accessibilityRole="button"
                  accessibilityLabel={o.a11y}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.thumb,
                    selected && styles.thumbSelected,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <T variant="bodyStrong" style={selected ? { color: colors.onAccent } : undefined}>
                    {o.label}
                  </T>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <T variant="heading">How was it?</T>
          <Stars value={stars} onChange={setStars} />
          {fromCT && note.rating && stars === startStars ? (
            <T variant="caption">Your CellarTracker score: {Math.round(note.rating)}</T>
          ) : null}
          <VoiceField
            value={text}
            onChange={setText}
            placeholder="Your note, typed or spoken"
            multiline
            accessibilityLabel="Tasting note"
          />
        </View>

        <View style={styles.section}>
          <T variant="overline">How ready did it seem?</T>
          <View style={styles.wrap}>
            {MATURITY.map((m) => (
              <Chip
                key={m.key}
                label={m.label}
                selected={maturity === m.key}
                onPress={() => setMaturity(maturity === m.key ? null : m.key)}
              />
            ))}
          </View>
          <VoiceField
            label="Food"
            value={food}
            onChange={setFood}
            placeholder="What you ate with it"
          />
          <VoiceField
            label="Occasion"
            value={occasion}
            onChange={setOccasion}
            placeholder="Who with, where"
          />
          <T variant="overline">Buy it again?</T>
          <View style={styles.wrap}>
            <Chip
              label="Yes"
              selected={buyAgain === true}
              onPress={() => setBuyAgain(buyAgain === true ? null : true)}
            />
            <Chip
              label="No"
              selected={buyAgain === false}
              onPress={() => setBuyAgain(buyAgain === false ? null : false)}
            />
          </View>
        </View>

        <View style={styles.buttons}>
          <Button
            label={changed ? 'Save changes' : 'Done'}
            onPress={save}
            loading={busy === 'save'}
            disabled={busy === 'delete'}
          />
        </View>

        <View style={styles.deleteBox}>
          {!askDelete ? (
            <Pressable
              onPress={() => setAskDelete(true)}
              accessibilityRole="button"
              hitSlop={6}
              style={styles.deleteLink}
            >
              <T variant="bodyStrong" style={{ color: colors.danger }}>
                Delete this note
              </T>
            </Pressable>
          ) : (
            <View style={styles.confirm}>
              <T variant="body">Delete this note for good? Your bottles are not affected.</T>
              <View style={styles.confirmRow}>
                <Pressable
                  onPress={remove}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.85 }]}
                >
                  <T variant="bodyStrong" style={{ color: '#fff' }}>
                    {busy === 'delete' ? 'Deleting…' : 'Yes, delete it'}
                  </T>
                </Pressable>
                <Pressable
                  onPress={() => setAskDelete(false)}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  style={styles.keepButton}
                >
                  <T variant="bodyStrong">Keep it</T>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} accessibilityRole="button" hitSlop={10} style={styles.backButton}>
        <Icon name="back" size={22} />
        <T variant="body">Back</T>
      </Pressable>
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
    paddingTop: 0,
    paddingBottom: 48,
    gap: space.xs,
  },
  section: { gap: space.md, marginTop: space.xl },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumbs: { flexDirection: 'row', gap: space.sm },
  thumb: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttons: { marginTop: space.xl },
  deleteBox: { marginTop: space.xl, alignItems: 'center' },
  deleteLink: { paddingVertical: space.md },
  confirm: {
    width: '100%',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  confirmRow: { flexDirection: 'row', gap: space.sm },
  deleteButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: 14,
    backgroundColor: colors.danger,
  },
  keepButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
