import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Stepper, SwitchRow } from '../../components/controls';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Button, Chip, T } from '../../components/ui';
import { VoiceField } from '../../components/VoiceField';
import { useCellarData } from '../../data/CellarData';
import { useLastCellar } from '../../data/lastCellar';
import { addBottles, undoEvents } from '../../data/writes';
import { MAX_CONTENT_WIDTH, colors, fonts, radius, space } from '../../lib/theme';
import { findWines, parseSpokenAdd, spokenCellar, type WineMatch } from '../../logic/adding';
import { ALL_CELLARS, formatPrice, plural } from '../../logic/cellar';

const SIZES = [
  { ml: 750, label: 'Bottle' },
  { ml: 1500, label: 'Magnum' },
  { ml: 375, label: 'Half' },
];

function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

type Done = { eventIds: string[]; summary: string };

export default function AddManualScreen() {
  const params = useLocalSearchParams<{ wineId?: string; vintage?: string }>();
  const data = useCellarData();
  const toast = useToast();
  const [lastCellar] = useLastCellar(data.cellars.map((c) => c.id));

  const [cellarId, setCellarId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [wine, setWine] = useState<WineMatch | null>(null);
  const [newWine, setNewWine] = useState<{
    name: string;
    country: string;
    region: string;
    appellation: string;
  } | null>(null);
  const [vintage, setVintage] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [sizeMl, setSizeMl] = useState(750);
  const [price, setPrice] = useState('');
  const [onOrder, setOnOrder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefilled = useRef(false);

  // Default cellar: the one last viewed (or the first, when that was "All").
  useEffect(() => {
    if (cellarId || lastCellar === null || data.cellars.length === 0) return;
    setCellarId(lastCellar === ALL_CELLARS ? data.cellars[0].id : lastCellar);
  }, [cellarId, lastCellar, data.cellars]);

  // Opened from a Wine page: that wine and vintage are already chosen.
  useEffect(() => {
    if (prefilled.current || !params.wineId || data.status !== 'ready') return;
    const row = data.inventory.find((r) => r.wine_id === params.wineId);
    if (!row) return;
    prefilled.current = true;
    setWine(
      findWines(
        data.inventory.filter((r) => r.wine_id === params.wineId),
        row.wine_name,
      )[0] ?? null,
    );
    setVintage(params.vintage === 'NV' ? '' : (params.vintage ?? ''));
  }, [params.wineId, params.vintage, data.status, data.inventory]);

  const parsed = useMemo(() => parseSpokenAdd(text), [text]);
  const matches = useMemo(
    () => (wine || newWine ? [] : findWines(data.inventory, parsed.query)),
    [wine, newWine, data.inventory, parsed.query],
  );

  const onText = (t: string) => {
    setText(t);
    const p = parseSpokenAdd(t);
    if (p.quantity) setQuantity(p.quantity);
    if (p.vintage) setVintage(String(p.vintage));
    if (p.sizeMl) setSizeMl(p.sizeMl);
    if (p.onOrder) setOnOrder(true);
    const c = spokenCellar(t, data.cellars);
    if (c) setCellarId(c);
  };

  const cellar = data.cellars.find((c) => c.id === cellarId) ?? null;
  const year = vintage.trim() ? Number(vintage.trim()) : null;
  const yearOk =
    year === null ||
    (Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() + 1);
  const priceNum = price.trim() ? Number(price.replace(/[^0-9.]/g, '')) : null;
  const priceOk = priceNum === null || (Number.isFinite(priceNum) && priceNum >= 0);
  const name = wine?.name ?? newWine?.name.trim() ?? '';
  const ready = !!cellar && !!name && yearOk && priceOk && quantity > 0;

  const submit = async () => {
    if (!ready || !cellar) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addBottles(
        cellar.id,
        [
          {
            ...(wine
              ? { wine_id: wine.wineId }
              : {
                  wine_name: name,
                  country: newWine?.country.trim() || null,
                  region: newWine?.region.trim() || null,
                  appellation: newWine?.appellation.trim() || null,
                }),
            vintage: year,
            quantity,
            bottle_size_ml: sizeMl,
            unit_price: priceNum,
          },
        ],
        onOrder,
        'Added in the app',
      );
      await data.reload();
      const what = plural(
        quantity,
        sizeMl === 1500 ? 'magnum' : sizeMl === 375 ? 'half bottle' : 'bottle',
      );
      setDone({
        eventIds: res.eventIds,
        summary: `${what} of ${name} ${year ?? 'NV'} ${onOrder ? 'on order for' : 'added to'} ${cellar.name}.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!done) return;
    setBusy(true);
    try {
      await undoEvents(done.eventIds);
      await data.reload();
      toast('Undone. Nothing was added.');
      setDone(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDone(null);
    setText('');
    setWine(null);
    setNewWine(null);
    setVintage('');
    setQuantity(1);
    setSizeMl(750);
    setPrice('');
    setOnOrder(false);
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/add'));

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.scroll}>
          <View style={styles.doneBox}>
            <T variant="overline" style={{ color: colors.accent }}>
              Done
            </T>
            <T variant="heading">{done.summary}</T>
            <Pressable
              onPress={undo}
              disabled={busy}
              accessibilityRole="button"
              style={{ paddingVertical: space.sm }}
            >
              <T variant="bodyStrong" style={{ color: colors.accent }}>
                {busy ? 'Undoing…' : 'Undo'}
              </T>
            </Pressable>
          </View>
          <View style={{ gap: space.md, marginTop: space.xl }}>
            <Button label="Add another" onPress={reset} />
            <Button label="Done" kind="secondary" onPress={back} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={back} accessibilityRole="button" hitSlop={10} style={styles.backButton}>
          <Icon name="back" size={22} />
          <T variant="body">Back</T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <T variant="title">Type it or say it</T>

        <View style={styles.block}>
          <T variant="overline">Cellar</T>
          <View style={styles.wrap}>
            {data.cellars.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={c.id === cellarId}
                onPress={() => setCellarId(c.id)}
              />
            ))}
          </View>
        </View>

        {wine ? (
          <View style={styles.block}>
            <T variant="overline">Wine</T>
            <View style={styles.picked}>
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{wine.name}</T>
                <T variant="caption">{wine.place}</T>
              </View>
              <Pressable onPress={() => setWine(null)} accessibilityRole="button" hitSlop={8}>
                <T variant="caption" style={{ color: colors.accent }}>
                  Change
                </T>
              </Pressable>
            </View>
          </View>
        ) : newWine ? (
          <View style={styles.block}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T variant="overline">New wine</T>
              <Pressable onPress={() => setNewWine(null)} accessibilityRole="button" hitSlop={8}>
                <T variant="caption" style={{ color: colors.accent }}>
                  Search again
                </T>
              </Pressable>
            </View>
            <VoiceField
              label="Name"
              value={newWine.name}
              onChange={(v) => setNewWine({ ...newWine, name: v })}
            />
            <VoiceField
              label="Appellation or area (optional)"
              value={newWine.appellation}
              onChange={(v) => setNewWine({ ...newWine, appellation: v })}
              placeholder="e.g. Pauillac, Napa Valley"
            />
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <VoiceField
                  label="Region"
                  value={newWine.region}
                  onChange={(v) => setNewWine({ ...newWine, region: v })}
                  placeholder="Bordeaux"
                  voice={false}
                />
              </View>
              <View style={{ flex: 1 }}>
                <VoiceField
                  label="Country"
                  value={newWine.country}
                  onChange={(v) => setNewWine({ ...newWine, country: v })}
                  placeholder="France"
                  voice={false}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.block}>
            <VoiceField
              label="What are you adding?"
              value={text}
              onChange={onText}
              placeholder="Six bottles of 2019 Ridge Monte Bello"
              autoFocus
            />
            {parsed.query.length > 0 && (
              <View style={styles.results}>
                {matches.map((m) => (
                  <Pressable
                    key={m.wineId}
                    onPress={() => setWine(m)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.result,
                      pressed && { backgroundColor: colors.surface },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <T variant="bodyStrong">{m.name}</T>
                      <T variant="caption">
                        {[m.place, m.vintages.slice(0, 4).join(', ')].filter(Boolean).join(' · ')}
                      </T>
                    </View>
                    <Icon name="chevron" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
                <Pressable
                  onPress={() =>
                    setNewWine({
                      name: titleCase(parsed.query),
                      country: '',
                      region: '',
                      appellation: '',
                    })
                  }
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.result,
                    pressed && { backgroundColor: colors.surface },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong" style={{ color: colors.accent }}>
                      + New wine: “{titleCase(parsed.query)}”
                    </T>
                    <T variant="caption">Not in your cellar yet</T>
                  </View>
                </Pressable>
              </View>
            )}
          </View>
        )}

        <View style={styles.row2}>
          <View style={[styles.block, { flex: 1 }]}>
            <T variant="overline">Vintage</T>
            <TextInput
              value={vintage}
              onChangeText={setVintage}
              keyboardType="number-pad"
              placeholder="NV"
              placeholderTextColor={colors.textFaint}
              style={[styles.input, !yearOk && styles.inputBad]}
              accessibilityLabel="Vintage year"
              maxLength={4}
            />
          </View>
          <View style={[styles.block, { flex: 1 }]}>
            <T variant="overline">Price each ({cellar?.currency ?? 'USD'})</T>
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="optional"
              placeholderTextColor={colors.textFaint}
              style={[styles.input, !priceOk && styles.inputBad]}
              accessibilityLabel="Price per bottle"
            />
          </View>
        </View>

        <View style={styles.block}>
          <T variant="overline">How many</T>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}
          >
            <Stepper value={quantity} onChange={setQuantity} />
            {SIZES.map((s) => (
              <Chip
                key={s.ml}
                label={s.label}
                selected={sizeMl === s.ml}
                onPress={() => setSizeMl(s.ml)}
              />
            ))}
          </View>
        </View>

        <SwitchRow
          label="On order"
          caption="Paid for, not arrived yet. Mark it arrived later on the wine's page."
          value={onOrder}
          onChange={setOnOrder}
        />

        {error ? (
          <T variant="caption" style={{ color: colors.danger }}>
            {error}
          </T>
        ) : null}

        <Button
          label={
            name && cellar
              ? `Add ${plural(quantity, sizeMl === 1500 ? 'magnum' : sizeMl === 375 ? 'half bottle' : 'bottle')}${
                  onOrder ? ' as on order' : ''
                }${priceNum ? ` · ${formatPrice(priceNum * quantity, cellar.currency)}` : ''}`
              : 'Choose a wine first'
          }
          onPress={submit}
          disabled={!ready}
          loading={busy}
          style={{ marginTop: space.md }}
        />
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
  block: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row2: { flexDirection: 'row', gap: space.md },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.lg,
  },
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 50,
  },
  inputBad: { borderWidth: 1, borderColor: colors.danger },
  doneBox: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
  },
});
