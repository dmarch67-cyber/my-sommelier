import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Button, T } from '../components/ui';
import { useCellarData } from '../data/CellarData';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../lib/theme';

/**
 * My palate: what the app has worked out about the owner's taste, in plain
 * words. Any line can be marked "not really", and the quiz can be redone.
 */
export default function PalateScreen() {
  const data = useCellarData();
  const toast = useToast();
  const p = data.palate;
  const [busy, setBusy] = useState<string | null>(null);
  const settings = data.palateSettings ?? { quiz: {}, not_really: [] };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/notes'));

  const setNotReally = async (key: string, on: boolean) => {
    setBusy(key);
    try {
      const list = settings.not_really.filter((k) => k !== key);
      await data.updatePalate({ ...settings, not_really: on ? [...list, key] : list });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const wineName = (id: string) =>
    data.inventory.find((r) => r.wine_id === id)?.wine_name ?? 'A wine';
  const labelOf = (key: string) => {
    const [kind, ...rest] = key.split(':');
    const value = rest.join(':');
    if (kind === 'place') return value.split('|').filter(Boolean).reverse().join(', ');
    if (kind === 'dislike') return `${wineName(value)} isn’t for you`;
    if (kind === 'style') {
      const [colour, body] = value.split('-');
      return `Mostly ${body ? `${body}-bodied ` : ''}${colour === 'rose' ? 'rosé' : colour}s`;
    }
    return value;
  };

  const basis = [
    `${p.bottlesBought.toLocaleString()} bottles in your records (newer vintages count most)`,
    p.ownNotes > 0 ? `${p.ownNotes} of your own ratings (recent ones count most)` : null,
    p.quizDone ? 'your quiz' : null,
  ].filter(Boolean) as string[];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={back} accessibilityRole="button" hitSlop={10} style={styles.backButton}>
          <Icon name="back" size={22} />
          <T variant="body">Back</T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <T variant="title">My palate</T>
        <View style={styles.hero}>
          <T variant="heading">{p.headline}</T>
          {p.quizLine ? <T variant="body">{p.quizLine}</T> : null}
          <T variant="caption">
            Based on {basis.join(', ').replace(/, ([^,]*)$/, ' and $1')}. Your cellar shows only
            part of 20 years of drinking, and taste changes, so your quiz answers and thumbs count
            for more than the cellar.
          </T>
        </View>

        {p.quizDone ? (
          <Button
            label="Redo the taste quiz"
            kind="secondary"
            onPress={() => router.push('/palate-quiz')}
          />
        ) : (
          <View style={styles.quizCard}>
            <T variant="heading">Take the 2-minute taste quiz</T>
            <T variant="caption">
              Ten one-tap questions on things your cellar can’t tell: oak, tannin, fruit, and how
              adventurous Tonight should be.
            </T>
            <Button label="Start the quiz" onPress={() => router.push('/palate-quiz')} />
          </View>
        )}

        {p.lines.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <T variant="overline">What the app thinks you like</T>
            <T variant="caption">
              Tap “Not really” on anything that’s wrong, and Tonight stops leaning on it.
            </T>
            {p.lines.map((l) => (
              <View key={l.key} style={styles.line}>
                <T variant="body" style={{ flex: 1 }}>
                  {l.text}
                </T>
                <Pressable
                  onPress={() => setNotReally(l.key, true)}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Not really: ${l.text}`}
                  hitSlop={6}
                  style={({ pressed }) => [styles.notReally, pressed && { opacity: 0.6 }]}
                >
                  <T variant="caption" style={{ color: colors.accent }}>
                    {busy === l.key ? 'Saving…' : 'Not really'}
                  </T>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {settings.not_really.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <T variant="overline">You said not really</T>
            {settings.not_really.map((key) => (
              <View key={key} style={styles.line}>
                <T variant="body" style={{ flex: 1, color: colors.textMuted }}>
                  {labelOf(key)}
                </T>
                <Pressable
                  onPress={() => setNotReally(key, false)}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Undo: ${labelOf(key)}`}
                  hitSlop={6}
                  style={({ pressed }) => [styles.notReally, pressed && { opacity: 0.6 }]}
                >
                  <T variant="caption" style={{ color: colors.accent }}>
                    {busy === key ? 'Saving…' : 'Undo'}
                  </T>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <T variant="caption">
          Tonight puts bottles that fit your palate first. Ask for “surprise me” to step outside it.
          A thumbs up or down after Drink one keeps this up to date.
        </T>
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
    gap: space.lg,
  },
  hero: {
    gap: space.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  quizCard: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  notReally: { paddingVertical: space.xs, paddingHorizontal: space.sm },
});
