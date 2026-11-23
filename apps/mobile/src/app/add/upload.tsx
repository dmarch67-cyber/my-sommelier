import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SwitchRow } from '../../components/controls';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Button, Chip, T } from '../../components/ui';
import { useCellarData } from '../../data/CellarData';
import { useLastCellar } from '../../data/lastCellar';
import { addBottles, undoEvents, type AddLine } from '../../data/writes';
import { MAX_CONTENT_WIDTH, colors, fonts, radius, space } from '../../lib/theme';
import { readXlsx } from '../../lib/xlsx';
import { exactWine, findWines } from '../../logic/adding';
import { ALL_CELLARS, formatPrice, plural } from '../../logic/cellar';
import { parseCsv, parseDelivery, type DeliveryParse } from '../../logic/delivery';

type Line = DeliveryParse['lines'][number] & {
  include: boolean;
  /** Existing wine this line adds to; null = new wine. */
  match: { wineId: string; name: string } | null;
  /** A close name Dan can tap to use instead of creating a new wine. */
  suggestion: { wineId: string; name: string } | null;
};

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
      setLines(
        p.lines.map((l) => {
          const exact = exactWine(data.inventory, l.wineName);
          const near = exact ? null : findWines(data.inventory, l.wineName, 1)[0];
          return {
            ...l,
            include: true,
            match: exact ? { wineId: exact.wine_id, name: exact.wine_name } : null,
            suggestion: near ? { wineId: near.wineId, name: near.name } : null,
          };
        }),
      );
    } catch (e) {
      setProblem(`Couldn’t read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const chosen = lines.filter((l) => l.include);
  const totals = useMemo(
    () => ({
      bottles: chosen.reduce((n, l) => n + l.quantity, 0),
      newWines: new Set(chosen.filter((l) => !l.match).map((l) => l.wineName.toLowerCase())).size,
      cost: chosen.reduce((n, l) => n + (l.unitPrice ?? 0) * l.quantity, 0),
    }),
    [chosen],
  );

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const confirm = async () => {
    if (!cellar || chosen.length === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      // New wines are matched by name in the database too, so the same new
      // wine on two lines (two vintages or sizes) becomes one wine.
      const payload: AddLine[] = chosen.map((l) => ({
        ...(l.match
          ? { wine_id: l.match.wineId }
          : { wine_name: l.wineName, region: l.region, country: l.country }),
        vintage: l.vintage,
        quantity: l.quantity,
        bottle_size_ml: l.sizeMl,
        unit_price: l.unitPrice,
        score_raw: l.score?.raw ?? null,
        score_low: l.score?.low ?? null,
        score_high: l.score?.high ?? null,
        score_plus: l.score?.plus ?? false,
      }));
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
            onPress={() => router.replace('/')}
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

            <View style={styles.list}>
              {lines.map((l, i) => (
                <View key={l.row} style={[styles.line, !l.include && { opacity: 0.45 }]}>
                  <Pressable
                    onPress={() => update(i, { include: !l.include })}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: l.include }}
                    hitSlop={8}
                    style={[styles.check, l.include && styles.checkOn]}
                  >
                    {l.include ? <T style={styles.checkMark}>✓</T> : null}
                  </Pressable>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong">
                      {l.match?.name ?? l.wineName} {l.vintage ?? 'NV'}
                    </T>
                    <T variant="caption">
                      {[
                        `${l.quantity} × ${l.sizeMl === 750 ? 'bottle' : l.sizeMl === 1500 ? 'magnum' : `${l.sizeMl} ml`}`,
                        l.unitPrice != null && cellar
                          ? `${formatPrice(l.unitPrice, cellar.currency)} each`
                          : null,
                        l.score ? `score ${l.score.raw}` : null,
                        `row ${l.row}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </T>
                    {l.match ? (
                      <View style={styles.tagRow}>
                        <T variant="caption" style={styles.tagIn}>
                          In your cellar
                        </T>
                        {l.match.name !== l.wineName && (
                          <Pressable onPress={() => update(i, { match: null })} hitSlop={6}>
                            <T variant="caption" style={{ color: colors.accent }}>
                              Not this wine
                            </T>
                          </Pressable>
                        )}
                      </View>
                    ) : (
                      <View style={styles.tagRow}>
                        <T variant="caption" style={styles.tagNew}>
                          New wine
                        </T>
                        {l.suggestion && (
                          <Pressable onPress={() => update(i, { match: l.suggestion })} hitSlop={6}>
                            <T variant="caption" style={{ color: colors.accent }}>
                              Same as “{l.suggestion.name}”?
                            </T>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>

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
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  line: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: colors.onAccent, fontFamily: fonts.bold, fontSize: 14, lineHeight: 16 },
  tagRow: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginTop: 2 },
  tagIn: { color: colors.textMuted },
  tagNew: {
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    overflow: 'hidden',
  },
});
