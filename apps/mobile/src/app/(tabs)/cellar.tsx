import { router } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LabelArt } from '../../components/LabelArt';
import { RipenessBar } from '../../components/RipenessBar';
import { SearchBar } from '../../components/SearchBar';
import { useToast } from '../../components/Toast';
import { Button, Chip, T } from '../../components/ui';
import { useCellarData } from '../../data/CellarData';
import { downloadExport } from '../../data/exportFile';
import { useLastCellar } from '../../data/lastCellar';
import { askCellar, AskError, type Answer } from '../../data/ask';
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
import { buildAskRows, looksLikeQuestion } from '../../logic/ask';
import { palateText } from '../../logic/palate';

type AskState = {
  question: string;
  status: 'loading' | 'done' | 'error';
  answer?: Answer;
  error?: string;
};

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
  const [ask, setAsk] = useState<AskState | null>(null);
  const askSeq = useRef(0);
  const [sort, setSort] = useState<SortKey>('ready');
  const year = new Date().getFullYear();
  const showAll = filter === ALL_CELLARS;
  const toast = useToast();

  const exportToExcel = () => {
    if (!filter) return;
    try {
      const { bottles } = downloadExport({
        cellars: data.cellars,
        inventory: data.inventory,
        scores: data.scores,
        notes: data.notes,
        maturity: data.maturity,
        bestScores: data.bestScores,
        filter,
      });
      const which = showAll
        ? 'all cellars'
        : (data.cellars.find((c) => c.id === filter)?.name ?? 'this cellar');
      toast(`Excel file downloaded: ${which}, ${bottles.toLocaleString('en-US')} bottles.`);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Could not make the Excel file.');
    }
  };

  const inCellar = useMemo(
    () => (filter ? groupInventory(data.inventory, filter, data.bestScores) : []),
    [data.inventory, data.bestScores, filter],
  );
  const sum = useMemo(() => totals(inCellar), [inCellar]);
  const shown = useMemo(
    () => sortItems(search(inCellar, query), sort, year),
    [inCellar, query, sort, year],
  );

  // Every wine in every cellar, for showing the wines an answer names.
  const everywhere = useMemo(
    () =>
      new Map(
        groupInventory(data.inventory, ALL_CELLARS, data.bestScores).map((i) => [i.vintageId, i]),
      ),
    [data.inventory, data.bestScores],
  );
  const answerItems = useMemo(
    () =>
      ask?.status === 'done'
        ? (ask.answer?.wine_ids ?? [])
            .map((id) => everywhere.get(id))
            .filter((i): i is CellarItem => !!i)
        : [],
    [ask, everywhere],
  );

  const changeQuery = useCallback((text: string) => {
    setQuery(text);
    setAsk((a) => (a && a.question !== text.trim() ? null : a));
  }, []);

  const runAsk = useCallback(
    async (question: string) => {
      const seq = ++askSeq.current;
      setAsk({ question, status: 'loading' });
      try {
        const answer = await askCellar({
          question,
          rows: buildAskRows({
            inventory: data.inventory,
            scores: data.scores,
            notes: data.notes,
            maturity: data.maturity,
            critics: data.critics,
            bestScores: data.bestScores,
            year,
          }),
          cellars: data.cellars.map((c) => c.name),
          lookingAt: showAll ? null : (data.cellars.find((c) => c.id === filter)?.name ?? null),
          year,
          palate: palateText(data.palate),
        });
        if (seq === askSeq.current) setAsk({ question, status: 'done', answer });
      } catch (e: unknown) {
        if (seq !== askSeq.current) return;
        setAsk({
          question,
          status: 'error',
          error: e instanceof AskError ? e.message : 'Something went wrong asking the sommelier.',
        });
      }
    },
    [data, filter, showAll, year],
  );

  // Enter, or the end of speaking: answer it if it reads like a question.
  const submit = useCallback(
    (text: string) => {
      const q = text.trim();
      // A wine name found in any cellar stays a name search.
      if (!q || !looksLikeQuestion(q, search([...everywhere.values()], q).length)) return;
      if (ask && ask.question === q && ask.status !== 'error') return;
      runAsk(q);
    },
    [everywhere, ask, runAsk],
  );

  // Cellars that do have a wine by this name, when the one on screen has none.
  const elsewhere = useMemo(() => {
    if (showAll || !query.trim() || shown.length > 0) return [];
    const names = new Set(search([...everywhere.values()], query).flatMap((i) => i.cellarNames));
    return [...names];
  }, [showAll, query, shown.length, everywhere]);

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
        <View style={styles.titleActions}>
          <Pressable
            onPress={exportToExcel}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={
              showAll ? 'Export all cellars to Excel' : 'Export this cellar to Excel'
            }
            style={styles.exportButton}
          >
            <T variant="caption" style={styles.exportText}>
              Export to Excel
            </T>
          </Pressable>
          <Pressable onPress={signOut} hitSlop={10} accessibilityRole="button">
            <T variant="caption">Sign out</T>
          </Pressable>
        </View>
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

      <SearchBar
        value={query}
        onChange={changeQuery}
        onSubmit={submit}
        placeholder="Search a wine, or ask a question"
      />

      {ask ? <AnswerCard ask={ask} onRetry={() => runAsk(ask.question)} /> : null}

      {ask ? null : (
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
      )}
    </View>
  );
  const asking = ask !== null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={asking ? answerItems : shown}
        keyExtractor={(i) => i.vintageId}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <WineRow item={item} year={year} showCellars={showAll || asking} />
        )}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          asking ? undefined : (
            <View style={styles.empty}>
              {query && elsewhere.length ? (
                <Pressable onPress={() => setFilter(ALL_CELLARS)} accessibilityRole="button">
                  <T variant="caption" style={{ textAlign: 'center' }}>
                    Nothing here matches “{query.trim()}”.{'\n'}
                    <T variant="caption" style={styles.askLink}>
                      It’s in {elsewhere.join(' and ')}. Show all cellars
                    </T>
                  </T>
                </Pressable>
              ) : query ? (
                <Pressable onPress={() => runAsk(query.trim())} accessibilityRole="button">
                  <T variant="caption" style={{ textAlign: 'center' }}>
                    No wine is called “{query.trim()}”.{'\n'}
                    <T variant="caption" style={styles.askLink}>
                      Press Enter to ask it as a question
                    </T>
                  </T>
                </Pressable>
              ) : (
                <T variant="caption">No bottles in this cellar yet.</T>
              )}
            </View>
          )
        }
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        windowSize={11}
      />
    </SafeAreaView>
  );
}

function AnswerCard({ ask, onRetry }: { ask: AskState; onRetry: () => void }) {
  return (
    <View style={styles.answer} accessibilityLiveRegion="polite">
      {ask.status === 'loading' ? (
        <View style={styles.answerLoading}>
          <ActivityIndicator color={colors.accent} />
          <T variant="caption">Looking through your cellar…</T>
        </View>
      ) : ask.status === 'error' ? (
        <View style={{ gap: space.sm }}>
          <T variant="body">{ask.error}</T>
          <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={6}>
            <T variant="caption" style={styles.askLink}>
              Try again
            </T>
          </Pressable>
        </View>
      ) : (
        <T variant="body" style={styles.answerText}>
          {ask.answer?.answer}
        </T>
      )}
    </View>
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
      <LabelArt
        wineId={item.wineId}
        vintageId={item.vintageId}
        name={item.wineName}
        vintage={item.vintage}
        colour={item.colour}
      />
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
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  exportButton: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exportText: { fontFamily: fonts.medium, color: colors.text },
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
  askLink: { fontFamily: fonts.medium, color: colors.accent },
  answer: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.sm,
  },
  answerLoading: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  answerText: { lineHeight: 24 },
});
