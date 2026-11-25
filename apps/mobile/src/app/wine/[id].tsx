import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Stars } from '../../components/controls';
import { Icon } from '../../components/Icon';
import { LabelPicture } from '../../components/LabelPicture';
import { RipenessBar } from '../../components/RipenessBar';
import { FoodMatches } from '../../components/FoodMatches';
import { Button, Card, Placeholder, Section, T } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { formatDay } from '../../lib/format';
import { useCellarData } from '../../data/CellarData';
import { useLastCellar } from '../../data/lastCellar';
import { drinkOne, markDelivered, undoEvents } from '../../data/writes';
import { defaultDrinkChoice, drinkChoices, type DrinkChoice } from '../../logic/adding';
import { MAX_CONTENT_WIDTH, colors, fonts, radius, space } from '../../lib/theme';
import {
  countsLine,
  drinkWindow,
  formatPrice,
  placeLine,
  ripeness,
  scoreLabel,
  scoreValue,
  sourceName,
  type InventoryRow,
} from '../../logic/cellar';

const COLOUR_NAMES: Record<string, string> = {
  red: 'Red',
  white: 'White',
  rose: 'Rosé',
  sparkling: 'Sparkling',
  sweet: 'Sweet',
  fortified: 'Fortified',
  orange: 'Orange',
};

const BODY_NAMES: Record<string, string> = {
  light: 'Light',
  medium: 'Medium',
  full: 'Full',
};

export default function WinePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useCellarData();
  const toast = useToast();
  const [lastCellar] = useLastCellar(data.cellars.map((c) => c.id));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const year = new Date().getFullYear();

  const view = useMemo(() => {
    const rows = data.inventory.filter((r) => r.vintage_id === id);
    if (rows.length === 0) return null;
    const first = rows[0];
    const scores = data.scores
      .filter((s) => s.vintage_id === id)
      .sort((a, b) => (scoreValue(b) ?? 0) - (scoreValue(a) ?? 0));
    const accolades = data.accolades
      .filter((a) => a.vintage_id === id)
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    const window = drinkWindow(first.drink_from, first.drink_to, data.bestScores.get(id) ?? null);

    // Bottles per cellar, in the cellars' usual order.
    const order = new Map(data.cellars.map((c, i) => [c.id, i]));
    const perCellar = new Map<string, { name: string; rows: InventoryRow[] }>();
    for (const r of rows) {
      const entry = perCellar.get(r.cellar_id) ?? { name: r.cellar_name, rows: [] };
      entry.rows.push(r);
      perCellar.set(r.cellar_id, entry);
    }
    const cellars = [...perCellar.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
      .map(([cellarId, { name, rows: cellarRows }]) => ({
        cellarId,
        name,
        onOrderRows: cellarRows.filter((r) => r.quantity_on_order > 0),
        bottles: cellarRows.reduce((n, r) => n + r.quantity, 0),
        magnums: cellarRows.reduce((n, r) => n + (r.bottle_size_ml === 1500 ? r.quantity : 0), 0),
        onOrder: cellarRows.reduce((n, r) => n + r.quantity_on_order, 0),
        prices: [
          ...new Set(
            cellarRows
              .map((r) =>
                formatPrice(r.unit_price, r.currency)?.concat(
                  r.is_non_standard_size ? ` (${r.bottle_size_label.toLowerCase()})` : '',
                ),
              )
              .filter(Boolean),
          ),
        ] as string[],
      }));

    // Other vintages of the same wine that are in the cellars.
    const others = new Map<
      string,
      { vintageId: string; vintage: number | null; bottles: number }
    >();
    for (const r of data.inventory) {
      if (r.wine_id !== first.wine_id || r.vintage_id === id) continue;
      const o = others.get(r.vintage_id) ?? {
        vintageId: r.vintage_id,
        vintage: r.vintage,
        bottles: 0,
      };
      o.bottles += r.quantity + r.quantity_on_order;
      others.set(r.vintage_id, o);
    }

    const notes = data.notes
      .filter((n) => n.vintage_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    return {
      wine: first,
      rows,
      notes,
      choices: drinkChoices(
        rows,
        data.cellars.map((c) => c.id),
      ),
      scores,
      accolades,
      ripeness: ripeness(window.from, window.to, year),
      // In the second half of its window or later: older bottles like simpler food.
      mature:
        window.from != null &&
        window.to != null &&
        year >= window.from + (window.to - window.from) / 2,
      cellars,
      total: {
        bottles: cellars.reduce((n, c) => n + c.bottles, 0),
        magnums: cellars.reduce((n, c) => n + c.magnums, 0),
        onOrder: cellars.reduce((n, c) => n + c.onOrder, 0),
      },
      others: [...others.values()]
        .filter((o) => o.bottles > 0)
        .sort((a, b) => (a.vintage ?? 0) - (b.vintage ?? 0)),
    };
  }, [data, id, year]);

  const critics = data.critics.get(id);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  /** Takes the bottle out at once, then opens the (optional) note. */
  const drink = async (choice: DrinkChoice) => {
    setPicking(false);
    setBusy(true);
    try {
      const eventId = await drinkOne(choice.holding);
      data.reload();
      router.push({
        pathname: '/drink-note',
        params: {
          eventId,
          vintageId: choice.holding.vintage_id,
          cellarName: choice.cellarName,
          left: String(choice.bottles - 1),
          size: choice.sizeMl === 750 ? '' : choice.sizeLabel.toLowerCase(),
        },
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDrinkPress = () => {
    if (!view) return;
    const choice = defaultDrinkChoice(view.choices, lastCellar);
    if (choice) drink(choice);
    else setPicking(true);
  };

  const arrived = async (rows: InventoryRow[], cellarName: string) => {
    const count = rows.reduce((n, r) => n + r.quantity_on_order, 0);
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const r of rows) ids.push(await markDelivered(r, r.quantity_on_order));
      await data.reload();
      toast(`${count} ${count === 1 ? 'bottle' : 'bottles'} arrived in ${cellarName}.`, {
        label: 'Undo',
        onPress: async () => {
          await undoEvents(ids);
          await data.reload();
          toast('Back on order.');
        },
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (data.status !== 'ready') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }
  if (!view) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar onBack={back} />
        <View style={styles.center}>
          <T variant="heading">Wine not found</T>
          <T variant="caption">It may have been removed from your cellar.</T>
        </View>
      </SafeAreaView>
    );
  }

  const { wine } = view;
  const place = placeLine(wine);
  const style = [
    wine.colour ? COLOUR_NAMES[wine.colour] : null,
    wine.body ? BODY_NAMES[wine.body] : null,
    wine.grapes?.length ? wine.grapes.join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar onBack={back} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <LabelPicture
            wineId={wine.wine_id}
            name={wine.wine_name}
            vintage={wine.vintage}
            colour={wine.colour}
          />
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <T variant="title" style={{ textAlign: 'center' }}>
              {wine.wine_name}
            </T>
            <T variant="heading" style={{ color: colors.textMuted, fontFamily: fonts.medium }}>
              {wine.vintage ?? 'Non-vintage'}
            </T>
            {place ? (
              <T variant="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
                {place}
              </T>
            ) : null}
            <T variant="caption" style={{ textAlign: 'center' }}>
              {style || 'Grape and style not known yet'}
            </T>
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            label="Drink one"
            onPress={onDrinkPress}
            disabled={view.choices.length === 0}
            loading={busy}
            style={{ flex: 1 }}
          />
          <Button
            label="Add bottles"
            kind="secondary"
            onPress={() =>
              router.push({
                pathname: '/add/manual',
                params: {
                  wineId: wine.wine_id,
                  vintage: wine.vintage == null ? 'NV' : String(wine.vintage),
                },
              })
            }
            style={{ flex: 1 }}
          />
        </View>
        {view.choices.length === 0 && (
          <T variant="caption" style={{ textAlign: 'center', marginTop: space.sm }}>
            No bottles left in the cellar.
          </T>
        )}
        {picking && (
          <Card style={{ marginTop: space.md, gap: space.sm }}>
            <T variant="bodyStrong">Which bottle?</T>
            {view.choices.map((c) => (
              <Pressable
                key={`${c.cellarId}-${c.sizeMl}`}
                onPress={() => drink(c)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.choice,
                  pressed && { backgroundColor: colors.border },
                ]}
              >
                <T variant="body">
                  {c.cellarName}
                  {c.sizeMl !== 750 ? ` · ${c.sizeLabel}` : ''}
                </T>
                <T variant="caption">{c.bottles} left</T>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setPicking(false)}
              accessibilityRole="button"
              style={{ alignSelf: 'center', padding: space.sm }}
            >
              <T variant="caption">Cancel</T>
            </Pressable>
          </Card>
        )}

        <Section title="Drinking window">
          <Card>
            <RipenessBar
              r={view.ripeness}
              estimate={view.wine.drink_window_source === 'estimate'}
            />
          </Card>
        </Section>

        <Section title="In your cellars" note={countsLine(view.total)}>
          <Card style={{ paddingVertical: space.xs }}>
            {view.cellars.map((c, i) => (
              <View key={c.cellarId} style={[styles.cellarRow, i > 0 && styles.rowDivider]}>
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">{c.name}</T>
                  {c.prices.length > 0 ? (
                    <T variant="caption">Paid {c.prices.join(', ')} a bottle</T>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: space.xs }}>
                  <T variant="body">{countsLine(c)}</T>
                  {c.onOrderRows.length > 0 && (
                    <Pressable
                      onPress={() => arrived(c.onOrderRows, c.name)}
                      disabled={busy}
                      accessibilityRole="button"
                      hitSlop={6}
                      style={styles.smallButton}
                    >
                      <T
                        variant="caption"
                        style={{ color: colors.accent, fontFamily: fonts.semibold }}
                      >
                        Order arrived
                      </T>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </Card>
        </Section>

        <Section title="Scores">
          {view.scores.length === 0 ? (
            <Placeholder text="No scores yet. Critic and community scores will be added from Vinous and CellarTracker." />
          ) : (
            <Card style={{ paddingVertical: space.xs }}>
              {view.scores.map((s, i) => (
                <View key={s.id} style={[styles.cellarRow, i > 0 && styles.rowDivider]}>
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">{sourceName(s)}</T>
                    <T variant="caption">
                      {s.source === 'unknown'
                        ? 'From your records'
                        : [s.reviewed_on, s.is_barrel_sample ? 'Barrel sample' : null]
                            .filter(Boolean)
                            .join(' · ')}
                    </T>
                  </View>
                  <View style={styles.scoreBadge}>
                    <T style={styles.scoreText}>
                      {scoreLabel(s.raw_value)}
                      {s.scale_max !== 100 ? `/${s.scale_max}` : ''}
                    </T>
                  </View>
                </View>
              ))}
            </Card>
          )}
          {view.accolades.map((a) => (
            <View key={a.id} style={styles.accolade}>
              <T variant="bodyStrong" style={{ color: colors.accent }}>
                {a.rank ? `#${a.rank} ` : ''}
                {a.title ?? a.raw_text}
              </T>
              <T variant="caption">{[a.publication, a.year].filter(Boolean).join(' · ')}</T>
            </View>
          ))}
        </Section>

        {view.notes.length > 0 && (
          <Section title="Your notes">
            {view.notes.map((n) => (
              <Card key={n.id} style={{ gap: space.xs }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Stars value={n.rating ? Math.round(n.rating / 20) : null} size={18} />
                  <T variant="caption">
                    {[
                      n.liked === true ? '👍' : n.liked === false ? '👎' : null,
                      n.tasted_on ? formatDay(n.tasted_on) : null,
                      n.source === 'cellartracker' ? 'From CellarTracker' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                </View>
                {n.notes ? <T variant="body">{n.notes}</T> : null}
                {[n.food_pairing && `With ${n.food_pairing}`, n.occasion].filter(Boolean).length >
                0 ? (
                  <T variant="caption">
                    {[n.food_pairing && `With ${n.food_pairing}`, n.occasion]
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                ) : null}
              </Card>
            ))}
          </Section>
        )}

        <Section title="What critics and drinkers say">
          {critics ? (
            <Card style={{ gap: space.md }}>
              <T variant="body">{critics.text}</T>
              {critics.latestYear ? (
                <T variant="caption">Notes through {critics.latestYear}</T>
              ) : null}
              {critics.url ? (
                <Pressable
                  onPress={() => Linking.openURL(critics.url as string)}
                  accessibilityRole="link"
                  hitSlop={8}
                  style={({ pressed }) => [styles.notesLink, pressed && { opacity: 0.6 }]}
                >
                  <T variant="bodyStrong" style={{ color: colors.accent }}>
                    Read the full notes on CellarTracker
                  </T>
                </Pressable>
              ) : null}
            </Card>
          ) : (
            <Placeholder text="No summary yet. One will appear after this wine's next review." />
          )}
        </Section>

        <Section title="Food matches">
          <FoodMatches wineId={wine.wine_id} mature={view.mature} />
        </Section>

        {view.others.length > 0 && (
          <Section title="Other vintages in your cellars">
            <View style={styles.others}>
              {view.others.map((o) => (
                <Pressable
                  key={o.vintageId}
                  onPress={() =>
                    router.push({ pathname: '/wine/[id]', params: { id: o.vintageId } })
                  }
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.other,
                    pressed && { backgroundColor: colors.border },
                  ]}
                >
                  <T variant="bodyStrong">{o.vintage ?? 'NV'}</T>
                  <T variant="caption">{o.bottles} btl</T>
                </Pressable>
              ))}
            </View>
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to cellar"
        hitSlop={10}
        style={styles.backButton}
      >
        <Icon name="back" size={22} color={colors.text} />
        <T variant="body">Cellar</T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  topBar: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
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
    paddingHorizontal: space.lg,
    paddingBottom: 48,
  },
  hero: { alignItems: 'center', gap: space.lg, paddingTop: space.sm },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
  cellarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
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
  notesLink: { alignSelf: 'flex-start' },
  accolade: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  others: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 50,
  },
  smallButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  other: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
});
