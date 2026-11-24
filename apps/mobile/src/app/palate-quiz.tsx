import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Button, T } from '../components/ui';
import { useCellarData } from '../data/CellarData';
import { QUIZ, quizPicks, type QuizAnswers } from '../logic/palate';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../lib/theme';

type Answers = Record<string, string | string[]>;

/**
 * The taste quiz, one question per screen, saved at the end. Single-choice
 * questions move on with one tap; "pick as many as you like" ones have Next.
 * ?from=<question key> starts at that question (to redo just a few).
 */
export default function PalateQuizScreen() {
  const data = useCellarData();
  const toast = useToast();
  const { from, until } = useLocalSearchParams<{ from?: string; until?: string }>();
  const last = until ? QUIZ.findIndex((q) => q.key === until) : -1;
  const lastStep = last >= 0 ? last : QUIZ.length - 1;
  const [answers, setAnswers] = useState<Answers>(() => {
    const saved = { ...(data.palateSettings?.quiz ?? {}) };
    // Older single answers ("Either", "Both") become the matching picks.
    for (const q of QUIZ) {
      if (q.multi && saved[q.key] != null) saved[q.key] = quizPicks(saved as QuizAnswers, q.key);
    }
    return saved;
  });
  const [step, setStep] = useState(() =>
    Math.max(
      0,
      QUIZ.findIndex((q) => q.key === from),
    ),
  );
  const [saving, setSaving] = useState(false);
  const q = QUIZ[step];

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/palate'));

  const finish = async (final: Answers) => {
    setSaving(true);
    try {
      await data.updatePalate({
        quiz: final,
        not_really: data.palateSettings?.not_really ?? [],
      });
      toast('Your palate is updated.');
      router.replace('/palate');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const next = (final: Answers) => {
    if (step < lastStep) setStep(step + 1);
    else finish(final);
  };

  const choose = (key: string) => {
    if (q.multi) {
      const cur = Array.isArray(answers[q.key]) ? (answers[q.key] as string[]) : [];
      const picks = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      setAnswers({ ...answers, [q.key]: picks });
      return;
    }
    const final = { ...answers, [q.key]: key };
    setAnswers(final);
    next(final);
  };

  const picked = (key: string) => {
    const v = answers[q.key];
    return Array.isArray(v) ? v.includes(key) : v === key;
  };
  const multiCount = q.multi && Array.isArray(answers[q.key]) ? answers[q.key]!.length : 0;

  const nextMulti = () => {
    const final = { ...answers };
    if (multiCount === 0) delete final[q.key];
    setAnswers(final);
    next(final);
  };

  const skip = () => {
    const final = { ...answers };
    delete final[q.key];
    setAnswers(final);
    next(final);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (step > 0 ? setStep(step - 1) : leave())}
          accessibilityRole="button"
          hitSlop={10}
          style={styles.backButton}
        >
          <Icon name="back" size={22} />
          <T variant="body">{step > 0 ? 'Previous' : 'Back'}</T>
        </Pressable>
        <T variant="caption">
          {step + 1} of {QUIZ.length}
        </T>
      </View>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${((step + 1) / QUIZ.length) * 100}%` }]} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <T variant="overline" style={{ color: colors.accent }}>
          Taste quiz
        </T>
        <T variant="title">{q.question}</T>
        {q.multi ? <T variant="caption">Pick as many as you like.</T> : null}
        <View style={{ gap: space.sm }}>
          {q.options.map((o) => {
            const selected = picked(o.key);
            return (
              <Pressable
                key={o.key}
                onPress={() => choose(o.key)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionSelected,
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
        {q.multi ? (
          <Button
            label={step < lastStep ? (multiCount > 0 ? 'Next' : 'Skip this one') : 'Finish'}
            onPress={nextMulti}
            loading={saving}
          />
        ) : null}
        {q.multi ? null : (
          <Pressable
            onPress={skip}
            disabled={saving}
            accessibilityRole="button"
            style={styles.skip}
          >
            <T variant="body" style={{ color: colors.textMuted }}>
              {saving ? 'Saving…' : 'Skip this one'}
            </T>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    padding: space.sm,
    paddingRight: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: space.sm },
  progress: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    height: 4,
    backgroundColor: colors.border,
  },
  progressFill: { height: 4, backgroundColor: colors.accent },
  scroll: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    padding: space.lg,
    paddingTop: space.xl,
    gap: space.lg,
  },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    backgroundColor: colors.background,
  },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  skip: { alignSelf: 'center', padding: space.md },
});
