import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Button, T } from '../../components/ui';
import { invoiceAddress, listInvoices, myAccountId, type InvoiceEmail } from '../../data/invoices';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../../lib/theme';
import { plural } from '../../logic/cellar';

function invoiceStatusText(inv: InvoiceEmail): string {
  const bottles = inv.reading?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
  switch (inv.status) {
    case 'reading':
      return 'Reading…';
    case 'ready':
      return `Ready to check · ${plural(bottles, 'bottle')}`;
    case 'failed':
      return 'Couldn’t read it';
    case 'added':
      return `Added · ${plural(bottles, 'bottle')}`;
    case 'dismissed':
      return 'Not added';
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function InvoicesScreen() {
  const toast = useToast();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  const [invoices, setInvoices] = useState<InvoiceEmail[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const id = accountId ?? (await myAccountId());
      if (!id) return;
      setAccountId(id);
      const [addr, list] = await Promise.all([
        address === undefined ? invoiceAddress(id) : Promise.resolve({ address }),
        listInvoices(),
      ]);
      setAddress(addr.address);
      setInvoices(list);
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, [accountId, address]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // While an invoice is being read, look again every few seconds.
  const reading = invoices?.some((i) => i.status === 'reading') ?? false;
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [reading, load]);

  const copy = async () => {
    if (!address) return;
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(address);
        toast('Address copied.');
      } else {
        toast('Press and hold the address to copy it.');
      }
    } catch {
      toast('Press and hold the address to copy it.');
    }
  };

  const makeNew = async () => {
    if (!accountId) return;
    if (!confirmNew) {
      setConfirmNew(true);
      return;
    }
    setBusy(true);
    try {
      const res = await invoiceAddress(accountId, true);
      setAddress(res.address);
      toast('New address made. The old one no longer works.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirmNew(false);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/add'));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={back} accessibilityRole="button" hitSlop={10} style={styles.backButton}>
          <Icon name="back" size={22} />
          <T variant="body">Back</T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <T variant="title">Email an invoice</T>
        <T variant="caption">
          Forward a merchant’s invoice or order confirmation to your private address. The app reads
          the email, or an attached PDF, photo or spreadsheet, and lists the bottles here for you to
          check. Nothing is added until you confirm, and it only ever adds.
        </T>

        <View style={styles.box}>
          <T variant="overline">Your private address</T>
          {address === undefined ? (
            <T variant="caption">Loading…</T>
          ) : address ? (
            <>
              <T variant="heading" selectable style={{ color: colors.accent }}>
                {address}
              </T>
              <T variant="caption">
                Keep it private: anything sent here shows up below. Tip: save it as a contact named
                “My Sommelier”.
              </T>
              <View style={styles.row}>
                <Button label="Copy address" onPress={copy} style={{ flex: 1 }} />
              </View>
              <Pressable onPress={makeNew} disabled={busy} hitSlop={6}>
                <T variant="caption" style={{ color: colors.accent }}>
                  {confirmNew
                    ? 'Tap again to make a new address (the old one will stop working)'
                    : 'Make a new address'}
                </T>
              </Pressable>
            </>
          ) : (
            <T variant="body">
              Email setup isn’t finished yet. Once it is, your address appears here.
            </T>
          )}
        </View>

        {problem ? (
          <T variant="body" style={{ color: colors.danger }}>
            {problem}
          </T>
        ) : null}

        <T variant="overline">Received</T>
        {invoices && invoices.length === 0 ? (
          <T variant="caption">No invoices yet. Forward one and it appears here in a minute.</T>
        ) : null}
        <View style={{ gap: space.sm }}>
          {(invoices ?? []).map((inv) => (
            <Pressable
              key={inv.id}
              onPress={() => router.push(`/add/invoice/${inv.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.border }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="bodyStrong" numberOfLines={1}>
                  {inv.reading?.merchant ?? inv.subject ?? '(no subject)'}
                </T>
                <T variant="caption" numberOfLines={1}>
                  {when(inv.received_at)}
                  {inv.from_address ? ` · from ${inv.from_address}` : ''}
                </T>
                <T
                  variant="caption"
                  style={{
                    color:
                      inv.status === 'ready'
                        ? colors.accent
                        : inv.status === 'failed'
                          ? colors.danger
                          : colors.textMuted,
                  }}
                >
                  {invoiceStatusText(inv)}
                </T>
              </View>
              <Icon name="chevron" size={20} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
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
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  row: { flexDirection: 'row', gap: space.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
});
