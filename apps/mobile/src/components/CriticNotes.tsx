import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { loadCriticNotes, noteCaption, type CriticNote } from '../data/criticNotes';
import { colors, fonts, radius, space } from '../lib/theme';
import { Card, T } from './ui';

const SHOW_FIRST = 3;

/**
 * Notes by critics, merchants and the winery for one vintage, as quoted on
 * public web pages, each with a link to its page. Long notes open on a tap;
 * after the first three, "Show all" lists the rest.
 */
export function CriticNotes({ vintageId }: { vintageId: string }) {
  const [notes, setNotes] = useState<CriticNote[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    setNotes([]);
    setAll(false);
    loadCriticNotes(vintageId).then((n) => live && setNotes(n));
    return () => {
      live = false;
    };
  }, [vintageId]);

  if (notes.length === 0) return null;
  const shown = all ? notes : notes.slice(0, SHOW_FIRST);
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View style={{ gap: space.sm }}>
      <T variant="caption" style={styles.heading}>
        Published notes ({notes.length})
      </T>
      <Card style={{ paddingVertical: space.xs }}>
        {shown.map((n, i) => (
          <View key={n.id} style={[styles.note, i > 0 && styles.divider]}>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{n.author}</T>
                <T variant="caption">{noteCaption(n)}</T>
              </View>
              {n.score ? (
                <View style={styles.scoreBadge}>
                  <T style={styles.scoreText}>{n.score}</T>
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={() => toggle(n.id)}
              accessibilityRole="button"
              accessibilityHint={open.has(n.id) ? 'Shows less' : 'Shows the whole note'}
            >
              <T variant="body" numberOfLines={open.has(n.id) ? undefined : 4}>
                {n.note}
              </T>
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL(n.source_url)}
              accessibilityRole="link"
              hitSlop={8}
              style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
            >
              <T variant="caption" style={{ color: colors.accent, fontFamily: fonts.semibold }}>
                Read on {n.source_site ?? 'the page'}
              </T>
            </Pressable>
          </View>
        ))}
      </Card>
      {notes.length > SHOW_FIRST ? (
        <Pressable
          onPress={() => setAll((a) => !a)}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
        >
          <T variant="bodyStrong" style={{ color: colors.accent }}>
            {all ? 'Show fewer' : `Show all ${notes.length} notes`}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    paddingHorizontal: space.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: fonts.semibold,
  },
  note: { gap: space.xs, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  scoreBadge: {
    minWidth: 48,
    paddingHorizontal: space.sm,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
  link: { alignSelf: 'flex-start' },
});
