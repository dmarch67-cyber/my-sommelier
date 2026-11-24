import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Stars } from '../components/controls';
import { useToast } from '../components/Toast';
import { Button, Chip, T } from '../components/ui';
import { VoiceField } from '../components/VoiceField';
import { useCellarData } from '../data/CellarData';
import { deleteNote, saveNote, undoEvents, type NoteInput } from '../data/writes';
import { MAX_CONTENT_WIDTH, colors, space } from '../lib/theme';
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
 * Shown right after Drink one. The bottle is already out of the cellar; this
 * screen only offers Undo and an optional note (stars + a line, or more).
 */
export default function DrinkNoteScreen() {
  const params = useLocalSearchParams<{
    eventId: string;
    vintageId: string;
    cellarName: string;
    left: string;
    size?: string;
  }>();
  const data = useCellarData();
  const toast = useToast();
  const wine = data.inventory.find((r) => r.vintage_id === params.vintageId);

  const [note, setNote] = useState<NoteInput>({
    stars: null,
    notes: '',
    maturity: null,
    food_pairing: '',
    occasion: '',
    would_buy_again: null,
    liked: null,
  });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<'save' | 'undo' | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const set = (patch: Partial<NoteInput>) => setNote((n) => ({ ...n, ...patch }));

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/wine/[id]', params: { id: params.vintageId } });
  };

  const hasNote =
    note.liked != null ||
    note.stars != null ||
    note.notes.trim() ||
    note.maturity ||
    note.food_pairing.trim() ||
    note.occasion.trim() ||
    note.would_buy_again != null;

  const save = async () => {
    if (!wine || !hasNote) return leave();
    setBusy('save');
    try {
      const id = await saveNote(
        savedId,
        {
          account_id: wine.account_id,
          vintage_id: params.vintageId,
          inventory_event_id: params.eventId,
        },
        note,
      );
      setSavedId(id);
      await data.reload();
      toast('Note saved.');
      leave();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    setBusy('undo');
    try {
      await undoEvents([params.eventId]);
      if (savedId) await deleteNote(savedId);
      await data.reload();
      toast('Bottle put back.');
      leave();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const left = Number(params.left);
  const bottle = params.size ? params.size : 'bottle';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.done}>
          <T variant="overline" style={{ color: colors.accent }}>
            Enjoy
          </T>
          <T variant="title">
            {wine ? `${wine.wine_name} ${wine.vintage ?? 'NV'}` : 'Bottle taken'}
          </T>
          <T variant="body" style={{ color: colors.textMuted }}>
            1 {bottle} taken from {params.cellarName}.{' '}
            {left === 0 ? 'That was the last one there.' : `${left} left there.`}
          </T>
          <Pressable
            onPress={undo}
            disabled={busy !== null}
            accessibilityRole="button"
            style={styles.undo}
            hitSlop={6}
          >
            <T variant="bodyStrong" style={{ color: colors.accent }}>
              {busy === 'undo' ? 'Putting it back…' : 'Undo, put it back'}
            </T>
          </Pressable>
        </View>

        <View style={styles.section}>
          <T variant="heading">Did you enjoy it?</T>
          <View style={styles.thumbs}>
            {[
              { v: true, label: '👍  Yes', a11y: 'Thumbs up' },
              { v: false, label: '👎  Not really', a11y: 'Thumbs down' },
            ].map((o) => {
              const selected = note.liked === o.v;
              return (
                <Pressable
                  key={String(o.v)}
                  onPress={() => set({ liked: selected ? null : o.v })}
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
          <T variant="caption">
            One tap keeps your palate up to date. Stars and a note are optional.
          </T>
        </View>

        <View style={styles.section}>
          <T variant="heading">How was it? (optional)</T>
          <Stars value={note.stars} onChange={(stars) => set({ stars })} />
          <VoiceField
            value={note.notes}
            onChange={(notes) => set({ notes })}
            placeholder="One line, typed or spoken"
            multiline={more}
            accessibilityLabel="Tasting note"
          />
        </View>

        {!more ? (
          <Pressable
            onPress={() => setMore(true)}
            accessibilityRole="button"
            style={{ paddingVertical: space.md }}
          >
            <T variant="bodyStrong" style={{ color: colors.accent }}>
              + Add more detail
            </T>
          </Pressable>
        ) : (
          <View style={styles.section}>
            <T variant="overline">How ready did it seem?</T>
            <View style={styles.wrap}>
              {MATURITY.map((m) => (
                <Chip
                  key={m.key}
                  label={m.label}
                  selected={note.maturity === m.key}
                  onPress={() => set({ maturity: note.maturity === m.key ? null : m.key })}
                />
              ))}
            </View>
            <VoiceField
              label="Food"
              value={note.food_pairing}
              onChange={(food_pairing) => set({ food_pairing })}
              placeholder="What you ate with it"
            />
            <VoiceField
              label="Occasion"
              value={note.occasion}
              onChange={(occasion) => set({ occasion })}
              placeholder="Who with, where"
            />
            <T variant="overline">Buy it again?</T>
            <View style={styles.wrap}>
              <Chip
                label="Yes"
                selected={note.would_buy_again === true}
                onPress={() =>
                  set({ would_buy_again: note.would_buy_again === true ? null : true })
                }
              />
              <Chip
                label="No"
                selected={note.would_buy_again === false}
                onPress={() =>
                  set({ would_buy_again: note.would_buy_again === false ? null : false })
                }
              />
            </View>
          </View>
        )}

        <View style={styles.buttons}>
          <Button
            label={hasNote ? 'Save note' : 'Done'}
            onPress={save}
            loading={busy === 'save'}
            disabled={busy === 'undo'}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    padding: space.lg,
    paddingBottom: 48,
  },
  done: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: space.xl,
    marginTop: space.lg,
  },
  undo: { alignSelf: 'flex-start', paddingVertical: space.sm },
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
});
