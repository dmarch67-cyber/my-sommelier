import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LabelArt } from '../../components/LabelArt';
import { RipenessBar } from '../../components/RipenessBar';
import { SearchBar } from '../../components/SearchBar';
import { Button, Chip, T } from '../../components/ui';
import { useCellarData } from '../../data/CellarData';
import { useLastCellar } from '../../data/lastCellar';
import { useAuth } from '../../lib/auth';
import { MAX_CONTENT_WIDTH, colors, fonts, radius, space } from '../../lib/theme';
import {
  ALL_CELLARS,
  countsLine,
  groupInventory,
  placeLine,
  ripeness,
  search,
  sortItems,
  totals,
  type CellarItem,
  type SortKey,
} from '../../logic/cellar';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'ready', label: 'Ready to drink' },
  { key: 'region', label: 'Region' },
  { key: 'score', label: 'Score' },
];

export default function CellarScreen() {
  const data = useCellarData();
  const { signOut } = useAuth();
  const [filter, setFilter] = useLastCellar(data.cellars.map((c) => c.id));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('ready');
  const year = new Date().getFullYear();
  const showAll = filter === ALL_CELLARS;

  const inCellar = useMemo(
    () => (filter ? groupInventory(data.inventory, filter, data.bestScores) : []),
    [data.inventory, data.bestScores, filter],
  );
  const sum = useMemo(() => totals(inCellar), [inCellar]);
  const shown = useMemo(
    () => sortItems(search(inCellar, query), sort, year),
    [inCellar, query, sort, year],
  );

  if (data.status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <T variant="heading">Couldn’t load your cellar</T>
          <T variant="caption" style={{ textAlign: 'center' }}>
            {data.error}
          </T>
          <Button label="Try again" onPress={data.reload} style={{ marginTop: space.lg }} />
        </View>
      </SafeAreaView>
    );
  }
  if (data.status === 'loading' || filter === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <T variant="caption">Opening your cellar…</T>
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <T variant="title">Cellar</T>
        <Pressable onPress={signOut} hitSlop={10} accessibilityRole="button">
          <T variant="caption">Sign out</T>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {data.cellars.map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            selected={filter === c.id}
            onPress={() => setFilter(c.id)}
          />
        ))}
        <Chip
          label="All"
          selected={showAll}
          onPress={() => setFilter(ALL_CELLARS)}
          accessibilityLabel="All cellars"
        />
      </ScrollView>

      <View style={styles.stats}>
        <Stat value={sum.bottles} label="bottles" />
        <Stat value={sum.magnums} label="magnums" />
        <Stat value={sum.onOrder} label="on order" />
      </View>

      <SearchBar value={query} onChange={setQuery} placeholder="Search wine, region, year" />

      <View style={styles.sortRow}>
        <T variant="caption">
          {query
            ? `${shown.length} of ${sum.wines} wines`
            : `${sum.wines.toLocaleString('en-US')} wines`}
        </T>
        <View style={styles.sorts}>
          {SORTS.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => setSort(s.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === s.key }}
              hitSlop={6}
              style={[styles.sort, sort === s.key && styles.sortOn]}
            >
              <T
                variant="caption"
                style={[styles.sortText, sort === s.key && { color: colors.text }]}
              >
                {s.label}
              </T>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={shown}
        keyExtractor={(i) => i.vintageId}
        ListHeaderComponent={header}
        renderItem={({ item }) => <WineRow item={item} year={year} showCellars={showAll} />}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          <View style={styles.empty}>
            <T variant="caption">
              {query ? `Nothing matches “${query}”.` : 'No bottles in this cellar yet.'}
            </T>
          </View>
        }
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        windowSize={11}
      />
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <T style={styles.statValue}>{value.toLocaleString('en-US')}</T>
      <T variant="caption">{label}</T>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const WineRow = memo(function WineRow({
  item,
  year,
  showCellars,
}: {
  item: CellarItem;
  year: number;
  showCellars: boolean;
}) {
  const r = ripeness(item.drinkFrom, item.drinkTo, year);
  const place = placeLine(item);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/wine/[id]', params: { id: item.vintageId } })}
      accessibilityRole="button"
      accessibilityLabel={`${item.wineName} ${item.vintage ?? 'NV'}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
    >
      <LabelArt name={item.wineName} vintage={item.vintage} colour={item.colour} />
      <View style={styles.rowBody}>
        <T variant="bodyStrong" numberOfLines={2}>
          {item.wineName} <T style={styles.vintage}>{item.vintage ?? 'NV'}</T>
        </T>
        {place ? (
          <T variant="caption" numberOfLines={1}>
            {place}
          </T>
        ) : null}
        <T variant="caption" style={{ color: colors.text }}>
          {countsLine(item)}
          {showCellars ? `  ·  ${item.cellarNames.join(', ')}` : ''}
        </T>
        {r.state !== 'unknown' && (
          <View style={{ marginTop: space.xs, maxWidth: 180 }}>
            <RipenessBar r={r} compact />
          </View>
        )}
      </View>
      {item.scoreText ? (
        <View style={styles.score}>
          <T style={styles.scoreText}>{item.scoreText}</T>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  list: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingBottom: space.xxl,
  },
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { gap: space.sm },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  statValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.sm,
  },
  sorts: { flexDirection: 'row', gap: space.xs },
  sort: { paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.pill },
  sortOn: { backgroundColor: colors.surface },
  sortText: { fontFamily: fonts.medium },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 72,
  },
  rowBody: { flex: 1, gap: 2 },
  vintage: { fontFamily: fonts.regular, color: colors.textMuted, fontSize: 15 },
  score: {
    minWidth: 44,
    paddingHorizontal: space.sm,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accent },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: space.lg + 48 + space.md },
  empty: { padding: space.xxl, alignItems: 'center' },
});
