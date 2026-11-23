import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ComingSoon } from '../../components/ComingSoon';
import { Stars } from '../../components/controls';
import { T } from '../../components/ui';
import { useCellarData } from '../../data/CellarData';
import { formatDay } from '../../lib/format';
import { MAX_CONTENT_WIDTH, colors, space } from '../../lib/theme';

/** Your own tasting notes, newest first. */
export default function NotesScreen() {
  const data = useCellarData();

  const notes = useMemo(() => {
    const names = new Map(
      data.inventory.map((r) => [r.vintage_id, `${r.wine_name} ${r.vintage ?? 'NV'}`]),
    );
    return [...data.notes]
      .sort(
        (a, b) =>
          b.tasted_on.localeCompare(a.tasted_on) || b.created_at.localeCompare(a.created_at),
      )
      .map((n) => ({ ...n, wine: names.get(n.vintage_id) ?? 'Wine' }));
  }, [data.notes, data.inventory]);

  if (data.status === 'ready' && notes.length === 0) {
    return (
      <ComingSoon
        icon="note"
        title="No notes yet"
        text="When you tap Drink one on a wine, you can give it stars and a line. Your notes collect here."
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <T variant="title" style={{ marginBottom: space.md }}>
            Notes
          </T>
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
              <T variant="caption">{formatDay(item.tasted_on)}</T>
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
});
