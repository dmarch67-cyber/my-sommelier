import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SwitchRow } from '../../components/controls';
import { Icon } from '../../components/Icon';
import { ReviewList } from '../../components/ReviewList';
import { useToast } from '../../components/Toast';
import { Button, Chip, T } from '../../components/ui';
import { useCellarData } from '../../data/CellarData';
import { useLastCellar } from '../../data/lastCellar';
import { addBottles, undoEvents } from '../../data/writes';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../../lib/theme';
import { readXlsx } from '../../lib/xlsx';
import { ALL_CELLARS, formatPrice, plural } from '../../logic/cellar';
import { parseCsv, parseDelivery, type DeliveryParse } from '../../logic/delivery';
import { fromDelivery, reviewTotals, toAddLines, type ReviewLine } from '../../logic/review';

type Line = ReviewLine;

async function readFile(asset: DocumentPicker.DocumentPickerAsset): Promise<Uint8Array> {
  if (asset.file) return new Uint8Array(await asset.file.arrayBuffer());
  if (asset.base64) {
    const bin = atob(asset.base64.replace(/^data:[^,]*,/, ''));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  return new Uint8Array(await (await fetch(asset.uri)).arrayBuffer());
}

export default function UploadScreen() {
  const data = useCellarData();
  const toast = useToast();
  const [lastCellar] = useLastCellar(data.cellars.map((c) => c.id));
  const [cellarId, setCellarId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parse, setParse] = useState<DeliveryParse | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [onOrder, setOnOrder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ eventIds: string[]; summary: string } | null>(null);

  useEffect(() => {
    if (cellarId || lastCellar === null || data.cellars.length === 0) return;
    setCellarId(lastCellar === ALL_CELLARS ? data.cellars[0].id : lastCellar);
  }, [cellarId, lastCellar, data.cellars]);

  const cellar = data.cellars.find((c) => c.id === cellarId) ?? null;

  const pick = async () => {
    setProblem(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'text/comma-separated-values',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const bytes = await readFile(asset);
      let rows: string[][];
      if (/\.csv$/i.test(asset.name) || asset.mimeType?.includes('csv')) {
        rows = parseCsv(new TextDecoder().decode(bytes));
      } else if (/\.xlsx$/i.test(asset.name)) {
        rows = readXlsx(bytes);
      } else {
        setProblem(
          'Please choose an Excel (.xlsx) or CSV file. Older .xls files: open in Excel and save as .xlsx.',
        );
        return;
      }
      const p = parseDelivery(rows);
      setFileName(asset.name);
      setParse(p);
      setLines(fromDelivery(data.inventory, p.lines));
    } catch (e) {
      setProblem(`Couldn’t read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const totals = useMemo(() => reviewTotals(lines), [lines]);
  const chosen = totals.chosen;

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const confirm = async () => {
    if (!cellar || chosen.length === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const payload = toAddLines(lines, cellar.currency);
      const res = await addBottles(
        cellar.id,
        payload,
        onOrder,
        `Delivery upload: ${fileName ?? 'spreadsheet'}`,
      );
      await data.reload();
      setDone({
        eventIds: res.eventIds,
        summary: `${plural(totals.bottles, 'bottle')} from ${plural(chosen.length, 'line')} ${
          onOrder ? 'added as on order for' : 'added to'
        } ${cellar.name}.`,
      });
    } catch (e) {
      setProblem(`Nothing was added. ${e instanceof Error ? e.message : String(e)}`);
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
      toast('Delivery undone. Your cellar is as it was.');
      setDone(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/add'));

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.scroll}>
          <View style={styles.box}>
            <T variant="overline" style={{ color: colors.accent }}>
              Delivery added
            </T>
            <T variant="heading">{done.summary}</T>
            <Pressable
              onPress={undo}
              disabled={busy}
              accessibilityRole="button"
              style={{ paddingVertical: space.sm }}
            >
              <T variant="bodyStrong" style={{ color: colors.accent }}>
                {busy ? 'Undoing…' : 'Undo the whole delivery'}
              </T>
            </Pressable>
          </View>
          <Button
            label="Done"
            onPress={() => router.replace('/cellar')}
            style={{ marginTop: space.xl }}
          />
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
      <ScrollView contentContainerStyle={styles.scroll}>
        <T variant="title">Upload a delivery</T>
        <T variant="caption">
          An Excel (.xlsx) or CSV list with at least a Wine column and a Qty or Bottles column.
          Vintage, size, price, region and score columns are used if present. Nothing is added until
          you confirm, and it only ever adds.
        </T>

        <Button
          label={parse ? 'Choose a different file' : 'Choose file'}
          kind={parse ? 'secondary' : 'primary'}
          onPress={pick}
        />

        {problem ? (
          <T variant="body" style={{ color: colors.danger }}>
            {problem}
          </T>
        ) : null}

        {parse?.error ? (
          <T variant="body" style={{ color: colors.danger }}>
            {fileName}: {parse.error}
          </T>
        ) : null}

        {parse && !parse.error && (
          <>
            <View style={styles.box}>
              <T variant="bodyStrong">{fileName}</T>
              <T variant="caption">
                Read columns:{' '}
                {Object.entries(parse.columns)
                  .map(([f, c]) => `${f} (${c})`)
                  .join(', ')}
              </T>
              <T variant="body">
                {plural(chosen.length, 'line')} · {plural(totals.bottles, 'bottle')}
                {totals.newWines > 0 ? ` · ${plural(totals.newWines, 'new wine')}` : ''}
                {totals.cost > 0 && cellar ? ` · ${formatPrice(totals.cost, cellar.currency)}` : ''}
              </T>
            </View>

            <View style={{ gap: space.sm }}>
              <T variant="overline">Add to</T>
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

            <SwitchRow
              label="These are on order"
              caption="Paid for, not arrived yet."
              value={onOrder}
              onChange={setOnOrder}
            />

            <ReviewList lines={lines} currency={cellar?.currency ?? null} onChange={update} />

            {parse.skipped.length > 0 && (
              <View style={styles.box}>
                <T variant="bodyStrong">Not added ({parse.skipped.length})</T>
                {parse.skipped.map((s) => (
                  <T key={s.row} variant="caption">
                    Row {s.row}: {s.reason}
                  </T>
                ))}
              </View>
            )}

            <Button
              label={
                cellar && chosen.length > 0
                  ? `Add ${plural(totals.bottles, 'bottle')} to ${cellar.name}${onOrder ? ' (on order)' : ''}`
                  : 'Pick at least one line'
              }
              onPress={confirm}
              disabled={!cellar || chosen.length === 0}
              loading={busy}
            />
          </>
        )}
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
  box: {
    gap: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
