import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { Stars } from '../../components/controls';
import { T } from '../../components/ui';
import { useCellarData } from '../../data/CellarData';
import { formatDay } from '../../lib/format';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../../lib/theme';

/** Your own tasting notes, newest first. Tap a note for the wine, or Edit to change or delete it. */
export default function NotesScreen() {
  const data = useCellarData();

  const notes = useMemo(() => {
    const names = new Map(
      data.inventory.map((r) => [r.vintage_id, `${r.wine_name} ${r.vintage ?? 'NV'}`]),
    );
    return [...data.notes]
      .sort(
        (a, b) =>
          (b.tasted_on ?? '').localeCompare(a.tasted_on ?? '') ||
          b.created_at.localeCompare(a.created_at),
      )
      .map((n) => ({ ...n, wine: names.get(n.vintage_id) ?? 'Wine' }));
  }, [data.notes, data.inventory]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={{ gap: space.lg, marginBottom: space.md }}>
            <T variant="title">Notes</T>
            <Pressable
              onPress={() => router.push('/palate')}
              accessibilityRole="button"
              accessibilityLabel="My palate"
              style={({ pressed }) => [styles.palate, pressed && { opacity: 0.85 }]}
            >
              <View style={{ flex: 1, gap: space.xs }}>
                <T variant="overline" style={{ color: colors.accent }}>
                  My palate
                </T>
                <T variant="body" numberOfLines={3}>
                  {data.status === 'ready' ? data.palate.headline : 'Working it out…'}
                </T>
                {data.status === 'ready' && !data.palate.quizDone ? (
                  <T variant="caption" style={{ color: colors.accent }}>
                    Take the 2-minute taste quiz
                  </T>
                ) : null}
              </View>
              <Icon name="chevron" size={20} color={colors.textMuted} />
            </Pressable>
            {notes.length > 0 ? <T variant="overline">Your notes</T> : null}
          </View>
        }
        ListEmptyComponent={
          data.status === 'ready' ? (
            <T variant="caption">
              No notes yet. When you tap Drink one on a wine, give it a thumbs up or down, and stars
              and a line if you like. Your notes collect here.
            </T>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/wine/[id]', params: { id: item.vintage_id } })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.note, pressed && { backgroundColor: colors.surface }]}
          >
            <View style={styles.head}>
              <T variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {item.wine}
              </T>
              <T variant="caption">
                {[
                  item.liked === true ? '👍' : item.liked === false ? '👎' : null,
                  item.tasted_on ? formatDay(item.tasted_on) : null,
                  item.source === 'cellartracker' ? 'CellarTracker' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </T>
              <Pressable
                onPress={() => router.push({ pathname: '/note-edit', params: { id: item.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Edit or delete note on ${item.wine}`}
                hitSlop={8}
                style={({ pressed }) => [styles.edit, pressed && { opacity: 0.7 }]}
              >
                <T variant="caption" style={{ color: colors.accent, fontWeight: '600' }}>
                  Edit
                </T>
              </Pressable>
            </View>
            {item.rating ? <Stars value={Math.round(item.rating / 20)} size={16} /> : null}
            {item.notes ? <T variant="body">{item.notes}</T> : null}
            {item.food_pairing ? <T variant="caption">With {item.food_pairing}</T> : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', padding: space.lg },
  note: {
    gap: space.xs,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  edit: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  palate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: space.lg,
  },
});
