import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { LabelArt } from '../../components/LabelArt';
import { RipenessBar } from '../../components/RipenessBar';
import { Button, Chip, T } from '../../components/ui';
import { useCellarData } from '../../data/CellarData';
import { useLastCellar } from '../../data/lastCellar';
import { askSommelier, SuggestError, type Suggestion } from '../../data/suggest';
import { MAX_CONTENT_WIDTH, colors, fonts, radius, space } from '../../lib/theme';
import { useVoiceInput } from '../../lib/voice';
import { ALL_CELLARS, groupInventory, plural, ripeness, type CellarItem } from '../../logic/cellar';
import {
  BODY_CHIPS,
  COLOUR_CHIPS,
  parseAsk,
  recommend,
  styleLine,
  toCandidate,
  type Pick,
  type ReadyState,
  type StyleBody,
  type StyleColour,
} from '../../logic/tonight';

const PAGE = 8;
/** Bottles offered to the sommelier per ask: the best matches first. */
const SOMMELIER_CANDIDATES = 60;

const READY_COLOR: Record<ReadyState, string> = {
  peak: colors.accent,
  ready: colors.accent,
  soon: '#9A4410',
  past: '#8A6D3B',
  unknown: colors.textMuted,
};

type Asked =
  | { state: 'idle' }
  | { state: 'asking'; key: string; ask: string }
  | { state: 'done'; key: string; ask: string; suggestion: Suggestion }
  | { state: 'error'; key: string; message: string };

export default function TonightScreen() {
  const data = useCellarData();
  const [filter, setFilter] = useLastCellar(data.cellars.map((c) => c.id));
  const [text, setText] = useState('');
  const [colour, setColour] = useState<StyleColour | null>(null);
  const [body, setBody] = useState<StyleBody | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [picker, setPicker] = useState(false);
  const [asked, setAsked] = useState<Asked>({ state: 'idle' });
  const [sommelierOff, setSommelierOff] = useState(false);
  const year = new Date().getFullYear();

  const items = useMemo(
    () => (filter ? groupInventory(data.inventory, filter, data.bestScores) : []),
    [data.inventory, data.bestScores, filter],
  );
  const everywhere = useMemo(
    () => groupInventory(data.inventory, ALL_CELLARS, data.bestScores),
    [data.inventory, data.bestScores],
  );
  const ask = useMemo(() => parseAsk(text), [text]);
  const result = useMemo(
    () =>
      recommend(items, {
        year,
        colour,
        body,
        ask,
        everywhere,
        maturity: data.maturity,
        notes: data.notes,
      }),
    [items, year, colour, body, ask, everywhere, data.maturity, data.notes],
  );

  // Back to the first page whenever the question changes.
  useEffect(() => setShown(PAGE), [text, colour, body, filter]);

  // The sommelier's answer belongs to one question in one cellar with one set of chips.
  const askKey = `${text.trim()}|${colour}|${body}|${filter}`;
  const current = asked.state !== 'idle' && asked.key === askKey ? asked : null;

  const askNow = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || sommelierOff) return;
      const key = `${q}|${colour}|${body}|${filter}`;
      const candidates = recommend(items, {
        year,
        colour,
        body,
        ask: parseAsk(q),
        everywhere,
        maturity: data.maturity,
        notes: data.notes,
      })
        .picks.slice(0, SOMMELIER_CANDIDATES)
        .map(toCandidate);
      if (candidates.length === 0) return;
      setAsked({ state: 'asking', key, ask: q });
      try {
        const suggestion = await askSommelier(q, candidates);
        setAsked((a) =>
          a.state === 'asking' && a.key === key ? { state: 'done', key, ask: q, suggestion } : a,
        );
      } catch (e) {
        if (e instanceof SuggestError && e.unavailable) {
          setSommelierOff(true);
          setAsked({ state: 'idle' });
          return;
        }
        const message = e instanceof Error ? e.message : 'The sommelier isn’t available right now.';
        setAsked((a) =>
          a.state === 'asking' && a.key === key ? { state: 'error', key, message } : a,
        );
      }
    },
    [colour, body, filter, items, everywhere, year, data.maturity, data.notes, sommelierOff],
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

  const cellarName =
    filter === ALL_CELLARS
      ? 'All cellars'
      : (data.cellars.find((c) => c.id === filter)?.name ?? 'All cellars');
  const style = result.chipsSetAside
    ? styleLine(ask.colour, ask.body)
    : styleLine(colour ?? ask.colour, body ?? ask.body);
  const byId = new Map(items.map((i) => [i.vintageId, i]));
  const sommelierPicks =
    current?.state === 'done'
      ? current.suggestion.picks
          .map((p) => ({ item: byId.get(p.id), why: p.why }))
          .filter((p): p is { item: CellarItem; why: string } => !!p.item)
      : [];
  const readyById = new Map(result.picks.map((p) => [p.item.vintageId, p]));
  const list = result.picks.slice(0, shown);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <T variant="title">Tonight</T>
          <Pressable
            onPress={() => setPicker((p) => !p)}
            accessibilityRole="button"
            accessibilityLabel={`Cellar: ${cellarName}. Change cellar`}
            style={styles.cellarButton}
          >
            <Icon name="cellar" size={16} color={colors.text} />
            <T variant="bodyStrong" style={{ fontSize: 14 }}>
              {cellarName}
            </T>
            <View style={{ transform: [{ rotate: picker ? '-90deg' : '90deg' }] }}>
              <Icon name="chevron" size={14} color={colors.textMuted} />
            </View>
          </Pressable>
        </View>

        {picker && (
          <View style={styles.pickerRow}>
            {data.cellars.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={filter === c.id}
                onPress={() => {
                  setFilter(c.id);
                  setPicker(false);
                }}
              />
            ))}
            <Chip
              label="All"
              selected={filter === ALL_CELLARS}
              accessibilityLabel="All cellars"
              onPress={() => {
                setFilter(ALL_CELLARS);
                setPicker(false);
              }}
            />
          </View>
        )}

        <AskBar
          value={text}
          onChange={setText}
          onAsk={askNow}
          canAsk={!sommelierOff}
          answered={current !== null}
        />

        <View style={styles.chipRows}>
          <View style={styles.chips}>
            {COLOUR_CHIPS.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                selected={colour === c.key}
                onPress={() => setColour(colour === c.key ? null : c.key)}
              />
            ))}
          </View>
          <View style={styles.chips}>
            {BODY_CHIPS.map((b) => (
              <Chip
                key={b.key}
                label={b.label}
                selected={body === b.key}
                onPress={() => setBody(body === b.key ? null : b.key)}
              />
            ))}
          </View>
        </View>

        {ask.foods.length > 0 && (
          <T variant="caption">
            {result.foodIgnored
              ? `${cap(ask.foods.map((f) => f.dish).join(' and '))} usually suits another colour, so these are simply the best ready ${style ? style.toLowerCase() : 'wines'}.`
              : `Chosen to go with ${ask.foods.map((f) => f.dish).join(' and ')}.`}
          </T>
        )}

        {result.chipsSetAside && (
          <View style={styles.setAside}>
            <T variant="caption" style={{ flex: 1 }}>
              Your question is more specific than the{' '}
              {[
                COLOUR_CHIPS.find((c) => c.key === colour)?.label,
                BODY_CHIPS.find((b) => b.key === body)?.label,
              ]
                .filter(Boolean)
                .join(' and ')}{' '}
              buttons, so they’re set aside for it.
            </T>
            <Pressable
              onPress={() => {
                setColour(null);
                setBody(null);
              }}
              accessibilityRole="button"
              hitSlop={8}
            >
              <T variant="bodyStrong" style={{ color: colors.accent, fontSize: 13 }}>
                Clear them
              </T>
            </Pressable>
          </View>
        )}

        {result.elsewhere.map((e) => (
          <View key={e.word} style={styles.elsewhere}>
            <T variant="body">{elsewhereText(e, cellarName, filter === ALL_CELLARS)}</T>
            {(colour || body) &&
            e.cellars.some((c) => c.name === cellarName || filter === ALL_CELLARS) ? (
              <Button
                kind="secondary"
                label="Clear the filters"
                onPress={() => {
                  setColour(null);
                  setBody(null);
                }}
              />
            ) : filter !== ALL_CELLARS ? (
              <Button
                kind="secondary"
                label="Look in all cellars"
                onPress={() => setFilter(ALL_CELLARS)}
              />
            ) : null}
          </View>
        ))}

        {current && (
          <SommelierCard
            asked={current}
            picks={sommelierPicks}
            readyById={readyById}
            year={year}
            onRetry={() => askNow(text)}
          />
        )}

        <View style={styles.sectionHead}>
          <T variant="heading" style={{ fontSize: 18 }}>
            Drinking best now
          </T>
          <T variant="caption" numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>
            {[style, cellarName].filter(Boolean).join(' · ')}
          </T>
        </View>

        {list.length === 0 && result.elsewhere.length > 0 ? null : list.length === 0 ? (
          <View style={styles.empty}>
            <T variant="body" style={{ textAlign: 'center' }}>
              {emptyText(colour ?? ask.colour, cellarName, result.matchedWords.length > 0)}
            </T>
            {filter !== ALL_CELLARS && (
              <Button
                kind="secondary"
                label="Look in all cellars"
                onPress={() => setFilter(ALL_CELLARS)}
                style={{ marginTop: space.md }}
              />
            )}
          </View>
        ) : (
          <View style={styles.cards}>
            {list.map((p) => (
              <PickCard
                key={p.item.vintageId}
                pick={p}
                year={year}
                showCellars={filter === ALL_CELLARS}
              />
            ))}
          </View>
        )}

        {result.picks.length > shown && (
          <Pressable
            onPress={() => setShown((s) => s + PAGE)}
            accessibilityRole="button"
            hitSlop={6}
            style={styles.more}
          >
            <T variant="bodyStrong" style={{ color: colors.accent }}>
              Show more ({plural(result.picks.length - shown, 'more wine')})
            </T>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const WORD_NAMES: Record<string, string> = {
  italy: 'Italian wine',
  france: 'French wine',
  spain: 'Spanish wine',
  usa: 'American wine',
  australia: 'Australian wine',
  germany: 'German wine',
};

function elsewhereText(
  e: { word: string; cellars: { name: string; wines: number }[] },
  cellar: string,
  all: boolean,
): string {
  const what = WORD_NAMES[e.word] ?? e.word[0].toUpperCase() + e.word.slice(1);
  const list = e.cellars.map((c) => `${c.name} (${plural(c.wines, 'wine')})`).join(' and ');
  const here = all || e.cellars.some((c) => c.name === cellar);
  if (here) return `${what} is in your cellar (${list}), but not with the filters you picked.`;
  return `No ${what} in ${cellar}. You have it in ${list}.`;
}

function emptyText(colour: StyleColour | null, cellar: string, named: boolean): string {
  if (named) return `Nothing ready to drink in ${cellar} matches that.`;
  const c = COLOUR_CHIPS.find((x) => x.key === colour);
  if (c) return `No ${c.plural} ready to drink in ${cellar}.`;
  return `Nothing ready to drink in ${cellar} with these choices.`;
}

/** The ask box: type or speak what you're eating or in the mood for. */
function AskBar({
  value,
  onChange,
  onAsk,
  canAsk,
  answered,
}: {
  value: string;
  onChange: (t: string) => void;
  onAsk: (t: string) => void;
  canAsk: boolean;
  /** The sommelier already has (or is working on) this question. */
  answered: boolean;
}) {
  const latest = useRef(value);
  latest.current = value;
  const voice = useVoiceInput(onChange);
  const wasListening = useRef(false);

  // When speaking stops, ask straight away (no need to press anything).
  useEffect(() => {
    if (wasListening.current && !voice.listening && latest.current.trim()) onAsk(latest.current);
    wasListening.current = voice.listening;
  }, [voice.listening, onAsk]);

  useEffect(() => {
    if (!voice.message) return;
    const t = setTimeout(voice.clearMessage, 4000);
    return () => clearTimeout(t);
  }, [voice.message, voice.clearMessage]);

  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.askBox}>
        <TextInput
          value={value}
          onChangeText={onChange}
          onSubmitEditing={() => onAsk(value)}
          placeholder={voice.listening ? 'Listening…' : 'What are you eating, or in the mood for?'}
          placeholderTextColor={colors.textFaint}
          style={styles.askInput}
          returnKeyType={canAsk ? 'send' : 'done'}
          accessibilityLabel="Ask your sommelier"
        />
        {value.length > 0 && (
          <Pressable
            onPress={() => onChange('')}
            hitSlop={10}
            accessibilityLabel="Clear"
            style={{ padding: space.xs }}
          >
            <Icon name="close" size={18} color={colors.textMuted} />
          </Pressable>
        )}
        <Pressable
          onPress={voice.toggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={voice.listening ? 'Stop listening' : 'Speak instead of typing'}
          style={[styles.askMic, voice.listening && styles.askMicOn]}
        >
          <Icon name="mic" size={20} color={colors.onAccent} />
        </Pressable>
      </View>
      {voice.message ? (
        <T variant="caption" style={{ marginLeft: space.md }}>
          {voice.message}
        </T>
      ) : value.trim() && canAsk && !answered ? (
        <T variant="caption" style={{ marginLeft: space.md }}>
          Press Enter to ask your sommelier.
        </T>
      ) : null}
    </View>
  );
}

function SommelierCard({
  asked,
  picks,
  readyById,
  year,
  onRetry,
}: {
  asked: Exclude<Asked, { state: 'idle' }>;
  picks: { item: CellarItem; why: string }[];
  readyById: Map<string, Pick>;
  year: number;
  onRetry: () => void;
}) {
  return (
    <View style={styles.sommelier}>
      <T variant="overline" style={{ color: colors.accent }}>
        Your sommelier suggests
      </T>
      {asked.state === 'asking' && (
        <View style={styles.thinking}>
          <ActivityIndicator color={colors.accent} />
          <T variant="caption">Choosing from your bottles…</T>
        </View>
      )}
      {asked.state === 'error' && (
        <View style={{ gap: space.sm }}>
          <T variant="caption">{asked.message}</T>
          <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={6}>
            <T variant="bodyStrong" style={{ color: colors.accent }}>
              Try again
            </T>
          </Pressable>
        </View>
      )}
      {asked.state === 'done' && (
        <View style={{ gap: space.md }}>
          {picks.length === 0 && (
            <T variant="body">
              {asked.suggestion.note ?? 'Nothing in this cellar fits that well.'}
            </T>
          )}
          {picks.map(({ item, why }) => {
            const ready = readyById.get(item.vintageId);
            return (
              <Pressable
                key={item.vintageId}
                onPress={() =>
                  router.push({ pathname: '/wine/[id]', params: { id: item.vintageId } })
                }
                accessibilityRole="button"
                accessibilityLabel={`${item.wineName} ${item.vintage ?? 'NV'}`}
                style={({ pressed }) => [styles.sommelierRow, pressed && { opacity: 0.7 }]}
              >
                <LabelArt name={item.wineName} vintage={item.vintage} colour={item.colour} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="bodyStrong" numberOfLines={2}>
                    {item.vintage ?? 'NV'} {item.wineName}
                  </T>
                  <T variant="body" style={{ color: colors.text }}>
                    {why}
                  </T>
                  <T variant="caption">
                    {[
                      ready?.ready.label,
                      plural(item.bottles, 'bottle'),
                      item.scoreText && `${item.scoreText} pts`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                </View>
              </Pressable>
            );
          })}
          {picks.length > 0 && asked.suggestion.note ? (
            <T variant="caption">{asked.suggestion.note}</T>
          ) : null}
        </View>
      )}
    </View>
  );
}

const PickCard = memo(function PickCard({
  pick,
  year,
  showCellars,
}: {
  pick: Pick;
  year: number;
  showCellars: boolean;
}) {
  const { item, ready, reasons } = pick;
  const r = ripeness(item.drinkFrom, item.drinkTo, year);
  const facts = [
    item.region ?? item.appellation ?? item.country,
    plural(item.bottles, 'bottle'),
    item.scoreText && `${item.scoreText} pts`,
    showCellars ? item.cellarNames.join(', ') : null,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/wine/[id]', params: { id: item.vintageId } })}
      accessibilityRole="button"
      accessibilityLabel={`${item.wineName} ${item.vintage ?? 'NV'}, ${ready.label}`}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surface }]}
    >
      <LabelArt name={item.wineName} vintage={item.vintage} colour={item.colour} />
      <View style={styles.cardBody}>
        <T variant="bodyStrong" numberOfLines={2}>
          {item.vintage ?? 'NV'} {item.wineName}
        </T>
        <T variant="caption" numberOfLines={1}>
          {facts.join(' · ')}
        </T>
        <View style={styles.readyRow}>
          {r.state !== 'unknown' && (
            <View style={{ flex: 1, maxWidth: 160 }}>
              <RipenessBar r={r} compact />
            </View>
          )}
          <T style={[styles.readyText, { color: READY_COLOR[ready.state] }]}>{ready.label}</T>
        </View>
        {reasons.length > 0 && (
          <T variant="caption" style={{ color: colors.text }}>
            {reasons.join(' · ')}
          </T>
        )}
      </View>
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
  page: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cellarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: -space.sm },
  askBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 54,
    paddingLeft: space.lg,
    paddingRight: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  askInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    paddingVertical: space.md,
    outlineStyle: 'none',
  } as object,
  askMic: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askMicOn: { backgroundColor: colors.text },
  chipRows: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sommelier: {
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    padding: space.lg,
    gap: space.md,
  },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sommelierRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.md,
  },
  cards: { gap: space.md },
  card: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cardBody: { flex: 1, gap: 3, minWidth: 0 },
  readyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  readyText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  more: { alignSelf: 'center', paddingVertical: space.sm },
  setAside: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  elsewhere: {
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: space.md,
  },
  empty: {
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
});
