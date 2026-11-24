import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SwitchRow } from '../../../components/controls';
import { Icon } from '../../../components/Icon';
import { ReviewList } from '../../../components/ReviewList';
import { useToast } from '../../../components/Toast';
import { Button, Chip, T } from '../../../components/ui';
import { useCellarData } from '../../../data/CellarData';
import { getInvoice, readAgain, setInvoiceStatus, type InvoiceEmail } from '../../../data/invoices';
import { useLastCellar } from '../../../data/lastCellar';
import { addBottles, undoEvents } from '../../../data/writes';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../../../lib/theme';
import { ALL_CELLARS, formatPrice, plural } from '../../../logic/cellar';
import { fromInvoice, reviewTotals, toAddLines, type ReviewLine } from '../../../logic/review';

export default function InvoiceReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useCellarData();
  const toast = useToast();
  const [lastCellar] = useLastCellar(data.cellars.map((c) => c.id));
  const [invoice, setInvoice] = useState<InvoiceEmail | null | undefined>(undefined);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [cellarId, setCellarId] = useState<string | null>(null);
  const [onOrder, setOnOrder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ eventIds: string[]; summary: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const inv = await getInvoice(String(id));
      setInvoice(inv);
      return inv;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Fill the lines and choices once the reading is in (and the cellar has loaded).
  const readingKey = invoice?.status === 'ready' ? invoice.id : null;
  useEffect(() => {
    if (!invoice?.reading || !readingKey || data.cellars.length === 0) return;
    setLines(fromInvoice(data.inventory, invoice.reading));
    setOnOrder(invoice.reading.looks_like_order);
    const fallback =
      lastCellar && lastCellar !== ALL_CELLARS ? lastCellar : (data.cellars[0]?.id ?? null);
    setCellarId(invoice.cellar_id ?? fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingKey, data.cellars.length]);

  // While it is being read, look again every few seconds.
  useEffect(() => {
    if (invoice?.status !== 'reading') return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [invoice?.status, load]);

  const cellar = data.cellars.find((c) => c.id === cellarId) ?? null;
  const totals = useMemo(() => reviewTotals(lines), [lines]);
  const reading = invoice?.reading ?? null;
  const otherCurrency =
    reading?.currency && cellar && reading.currency !== cellar.currency ? reading.currency : null;

  const update = (i: number, patch: Partial<ReviewLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const confirm = async () => {
    if (!invoice || !cellar || totals.lines === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await addBottles(
        cellar.id,
        toAddLines(lines, cellar.currency, reading?.merchant ?? null),
        onOrder,
        `Emailed invoice: ${reading?.merchant ?? invoice.subject ?? 'invoice'}`,
      );
      await setInvoiceStatus(invoice.id, 'added', {
        cellar_id: cellar.id,
        added_event_ids: res.eventIds,
      }).catch(() => undefined); // the bottles are in; the label can lag
      await data.reload();
      setDone({
        eventIds: res.eventIds,
        summary: `${plural(totals.bottles, 'bottle')} from ${plural(totals.lines, 'line')} ${
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
    if (!done || !invoice) return;
    setBusy(true);
    try {
      await undoEvents(done.eventIds);
      await setInvoiceStatus(invoice.id, 'ready', { added_event_ids: [] });
      await data.reload();
      toast('Invoice undone. Your cellar is as it was.');
      setDone(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tryAgain = async () => {
    if (!invoice) return;
    setBusy(true);
    setProblem(null);
    try {
      await readAgain(invoice.id);
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (!invoice) return;
    setBusy(true);
    try {
      await setInvoiceStatus(invoice.id, 'dismissed');
      toast('Set aside. Nothing was added.');
      back();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/add/invoices'));

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.scroll}>
          <View style={styles.box}>
            <T variant="overline" style={{ color: colors.accent }}>
              Invoice added
            </T>
            <T variant="heading">{done.summary}</T>
            <Pressable
              onPress={undo}
              disabled={busy}
              accessibilityRole="button"
              style={{ paddingVertical: space.sm }}
            >
              <T variant="bodyStrong" style={{ color: colors.accent }}>
                {busy ? 'Undoing…' : 'Undo the whole invoice'}
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
        <T variant="title">Check the invoice</T>

        {invoice === undefined ? <T variant="caption">Loading…</T> : null}
        {invoice === null ? <T variant="body">This invoice isn’t here any more.</T> : null}

        {invoice ? (
          <View style={styles.box}>
            <T variant="bodyStrong">{reading?.merchant ?? invoice.subject ?? '(no subject)'}</T>
            <T variant="caption">
              {[
                invoice.subject && reading?.merchant ? invoice.subject : null,
                invoice.from_address ? `from ${invoice.from_address}` : null,
                reading?.invoice_date ?? new Date(invoice.received_at).toLocaleDateString(),
              ]
                .filter(Boolean)
                .join(' · ')}
            </T>
            {invoice.status === 'ready' ? (
              <T variant="body">
                {plural(totals.lines, 'line')} · {plural(totals.bottles, 'bottle')}
                {totals.newWines > 0 ? ` · ${plural(totals.newWines, 'new wine')}` : ''}
                {totals.cost > 0 && (reading?.currency ?? cellar?.currency)
                  ? ` · ${formatPrice(totals.cost, reading?.currency ?? cellar!.currency)}`
                  : ''}
              </T>
            ) : null}
            {reading?.note ? (
              <T variant="caption" style={{ color: colors.danger }}>
                {reading.note}
              </T>
            ) : null}
          </View>
        ) : null}

        {invoice?.status === 'reading' ? (
          <T variant="body">Reading the invoice… this takes about a minute.</T>
        ) : null}

        {invoice?.status === 'failed' ? (
          <>
            <T variant="body" style={{ color: colors.danger }}>
              {invoice.error ?? 'The invoice couldn’t be read.'}
            </T>
            <Button label="Read again" onPress={tryAgain} loading={busy} />
            <Button label="Set it aside" kind="secondary" onPress={dismiss} disabled={busy} />
          </>
        ) : null}

        {invoice?.status === 'added' ? (
          <T variant="body">
            Already added
            {invoice.cellar_id
              ? ` to ${data.cellars.find((c) => c.id === invoice.cellar_id)?.name ?? 'a cellar'}`
              : ''}
            . To take bottles out, use the cellar.
          </T>
        ) : null}

        {invoice?.status === 'dismissed' ? (
          <>
            <T variant="body">You set this one aside. Nothing was added.</T>
            <Button
              label="Check it after all"
              kind="secondary"
              onPress={async () => {
                await setInvoiceStatus(invoice.id, 'ready').catch(() => undefined);
                await load();
              }}
            />
          </>
        ) : null}

        {invoice?.status === 'ready' && (
          <>
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
              {invoice.cellar_id && invoice.cellar_id === cellarId ? (
                <T variant="caption">Picked from the delivery address on the invoice.</T>
              ) : null}
            </View>

            <SwitchRow
              label="These are on order"
              caption={
                reading?.looks_like_order
                  ? 'The invoice looks like futures or a pre-arrival.'
                  : 'Paid for, not arrived yet.'
              }
              value={onOrder}
              onChange={setOnOrder}
            />

            {otherCurrency ? (
              <T variant="caption">
                Prices are in {otherCurrency}, and are kept in {otherCurrency} (not converted to{' '}
                {cellar!.currency}).
              </T>
            ) : null}

            <ReviewList lines={lines} currency={cellar?.currency ?? null} onChange={update} />

            {problem ? (
              <T variant="body" style={{ color: colors.danger }}>
                {problem}
              </T>
            ) : null}

            <Button
              label={
                cellar && totals.lines > 0
                  ? `Add ${plural(totals.bottles, 'bottle')} to ${cellar.name}${onOrder ? ' (on order)' : ''}`
                  : 'Pick at least one line'
              }
              onPress={confirm}
              disabled={!cellar || totals.lines === 0}
              loading={busy}
            />
            <View style={styles.row}>
              <Pressable onPress={tryAgain} disabled={busy} hitSlop={6}>
                <T variant="caption" style={{ color: colors.accent }}>
                  Read it again
                </T>
              </Pressable>
              <Pressable onPress={dismiss} disabled={busy} hitSlop={6}>
                <T variant="caption" style={{ color: colors.accent }}>
                  Don’t add this invoice
                </T>
              </Pressable>
            </View>
          </>
        )}

        {problem && invoice?.status !== 'ready' ? (
          <T variant="body" style={{ color: colors.danger }}>
            {problem}
          </T>
        ) : null}
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
  row: { flexDirection: 'row', gap: space.xl, justifyContent: 'center' },
});
