import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { canUseWebcam, WebCamera } from '../../components/WebCamera';
import { Button, T } from '../../components/ui';
import { useCellarData } from '../../data/CellarData';
import { labelFor, savePhotoLabel } from '../../data/labels';
import { LabelError, readLabel } from '../../data/readLabel';
import { MAX_SIDE, shrink } from '../../lib/photo';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../../lib/theme';
import { findWines } from '../../logic/adding';
import {
  addParams,
  knownWines,
  matchedWineId,
  readingPlace,
  type LabelReading,
} from '../../logic/label';

type State =
  | { step: 'pick' }
  | { step: 'webcam' }
  | { step: 'reading'; uri: string; base64?: string }
  | { step: 'read'; uri: string; base64: string; reading: LabelReading }
  | { step: 'failed'; uri: null; message: string; setup: boolean };

export default function LabelScreen() {
  const data = useCellarData();
  const [state, setState] = useState<State>({ step: 'pick' });
  const known = useMemo(() => knownWines(data.inventory), [data.inventory]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/add'));

  const read = async (photo: { uri: string; base64: string }) => {
    setState({ step: 'reading', uri: photo.uri });
    try {
      const reading = await readLabel(photo.base64, 'image/jpeg', known);
      setState({ step: 'read', uri: photo.uri, base64: photo.base64, reading });
    } catch (e) {
      fail(e);
    }
  };

  const fail = (e: unknown) =>
    setState({
      step: 'failed',
      uri: null,
      message: e instanceof Error ? e.message : String(e),
      setup: e instanceof LabelError && (e.code === 'no_key' || e.code === 'bad_key'),
    });

  const take = async (camera: boolean) => {
    // On a computer's browser, use the webcam live in the page.
    if (camera && canUseWebcam()) {
      setState({ step: 'webcam' });
      return;
    }
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setState({
            step: 'failed',
            uri: null,
            message:
              'The app needs the camera to snap a label. Allow it in Settings, or choose a photo.',
            setup: false,
          });
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
      const res = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setState({ step: 'reading', uri: asset.uri });
      const photo = await shrink(asset);
      await read({ uri: asset.uri, base64: photo.base64 });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={back} accessibilityRole="button" hitSlop={10} style={styles.backButton}>
          <Icon name="back" size={22} />
          <T variant="body">Back</T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <T variant="title">Snap the label</T>

        {state.step === 'pick' && (
          <>
            <T variant="caption">
              Take a photo of the front label, straight on and filling most of the picture. The app
              reads the wine and fills in the details for you to check.
            </T>
            <View style={{ gap: space.md, marginTop: space.lg }}>
              <BigButton icon="camera" label="Take a photo" onPress={() => take(true)} />
              <BigButton icon="image" label="Choose a photo" onPress={() => take(false)} />
            </View>
          </>
        )}

        {state.step === 'webcam' && (
          <WebCamera
            maxSide={MAX_SIDE}
            onSnap={read}
            onCancel={() => setState({ step: 'pick' })}
            onError={(message) => setState({ step: 'failed', uri: null, message, setup: false })}
          />
        )}

        {state.step === 'reading' && (
          <View style={{ gap: space.lg, alignItems: 'center' }}>
            <Image source={{ uri: state.uri }} style={styles.photo} resizeMode="contain" />
            <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
              <ActivityIndicator color={colors.accent} />
              <T variant="body">Reading the label… (about 10 seconds)</T>
            </View>
          </View>
        )}

        {state.step === 'read' && (
          <ReadResult
            uri={state.uri}
            base64={state.base64}
            reading={state.reading}
            onAgain={() => setState({ step: 'pick' })}
          />
        )}

        {state.step === 'failed' && (
          <View style={{ gap: space.lg }}>
            <View style={styles.problem}>
              <T variant="bodyStrong">{state.setup ? 'Not set up yet' : 'That didn’t work'}</T>
              <T variant="body">{state.message}</T>
            </View>
            <Button label="Try again" onPress={() => setState({ step: 'pick' })} />
            <Button
              label="Type it instead"
              kind="secondary"
              onPress={() => router.replace('/add/manual')}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReadResult({
  uri,
  base64,
  reading,
  onAgain,
}: {
  uri: string;
  base64: string;
  reading: LabelReading;
  onAgain: () => void;
}) {
  const data = useCellarData();
  const autoMatch = useMemo(
    () => matchedWineId(reading, data.inventory),
    [reading, data.inventory],
  );
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const wineId = chosen === undefined ? autoMatch : chosen;
  const matched = wineId ? data.inventory.find((r) => r.wine_id === wineId) : null;

  // Close names already in the cellar, in case the reader didn't link it.
  const nearby = useMemo(() => {
    if (autoMatch || !reading.wine_name) return [];
    const words = reading.wine_name.split(/\s+/).slice(0, 2).join(' ');
    return findWines(data.inventory, words, 4);
  }, [autoMatch, reading.wine_name, data.inventory]);

  if (!reading.is_wine_label || !reading.wine_name) {
    return (
      <View style={{ gap: space.lg }}>
        <Image source={{ uri }} style={styles.photo} resizeMode="contain" />
        <View style={styles.problem}>
          <T variant="bodyStrong">No wine label found</T>
          <T variant="body">
            {reading.note ?? 'Try again with the front label filling most of the photo.'}
          </T>
        </View>
        <Button label="Try another photo" onPress={onAgain} />
      </View>
    );
  }

  const go = () => {
    // The owner's photo becomes this vintage's label (and the wine's, if it
    // has none), unless they already chose their own photo for it.
    const vintageId = wineId
      ? (data.inventory.find((r) => r.wine_id === wineId && r.vintage === reading.vintage)
          ?.vintage_id ?? null)
      : null;
    const current = wineId ? labelFor(data.labels, wineId, vintageId ?? undefined) : undefined;
    const ownPhoto = current?.source === 'photo' && (current.level === 'vintage' || !vintageId);
    if (wineId && data.accountId && !ownPhoto) {
      savePhotoLabel(data.accountId, wineId, vintageId, base64, data.labels)
        .then(() => data.reload())
        .catch(() => {
          // A picture is a nice-to-have; adding the bottles carries on.
        });
    }
    router.replace({ pathname: '/add/manual', params: addParams(reading, wineId) });
  };

  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.readRow}>
        <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="overline" style={{ color: colors.accent }}>
            {reading.confidence === 'high' ? 'Label read' : 'Best reading, please check'}
          </T>
          <T variant="heading">
            {reading.wine_name} {reading.vintage ?? 'NV'}
          </T>
          <T variant="caption">
            {[readingPlace(reading), reading.bottle_size_ml === 1500 ? 'Magnum' : null]
              .filter(Boolean)
              .join(' · ')}
          </T>
        </View>
      </View>

      {reading.note ? (
        <T variant="caption" style={{ color: colors.textMuted }}>
          {reading.note}
        </T>
      ) : null}

      {matched ? (
        <View style={styles.matchBox}>
          <T variant="bodyStrong">Already in your cellar as “{matched.wine_name}”</T>
          <T variant="caption">The bottles will be added to that wine.</T>
          <Pressable onPress={() => setChosen(null)} accessibilityRole="button" hitSlop={8}>
            <T variant="caption" style={{ color: colors.accent, marginTop: space.xs }}>
              It’s a different wine
            </T>
          </Pressable>
        </View>
      ) : (
        <View style={styles.matchBox}>
          <T variant="bodyStrong">New to your cellar</T>
          <T variant="caption">It will be added as a new wine.</T>
          {nearby.length > 0 && (
            <View style={{ marginTop: space.sm, gap: space.xs }}>
              <T variant="caption">Or is it one of these?</T>
              {nearby.map((m) => (
                <Pressable
                  key={m.wineId}
                  onPress={() => setChosen(m.wineId)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.near, pressed && { opacity: 0.7 }]}
                >
                  <T variant="body" style={{ color: colors.accent }}>
                    {m.name}
                  </T>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      <Button label="Check and add bottles" onPress={go} />
      <Button label="Try another photo" kind="secondary" onPress={onAgain} />
    </View>
  );
}

function BigButton({
  icon,
  label,
  onPress,
}: {
  icon: 'camera' | 'image';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.big, pressed && { backgroundColor: colors.border }]}
    >
      <Icon name={icon} size={26} color={colors.accent} />
      <T variant="heading">{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: 6 },
  scroll: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    padding: space.lg,
    gap: space.md,
  },
  big: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    minHeight: 72,
  },
  photo: { width: '100%', height: 320, borderRadius: radius.md, backgroundColor: colors.surface },
  thumb: { width: 84, height: 112, borderRadius: radius.sm, backgroundColor: colors.surface },
  readRow: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  matchBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    gap: 2,
  },
  near: { paddingVertical: space.xs },
  problem: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
});
