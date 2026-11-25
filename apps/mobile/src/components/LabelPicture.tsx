import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { useCellarData } from '../data/CellarData';
import { removeLabel, savePhotoLabel } from '../data/labels';
import { shrink } from '../lib/photo';
import { colors, radius, space } from '../lib/theme';
import { LabelArt } from './LabelArt';
import { useToast } from './Toast';
import { T } from './ui';

/**
 * The big label picture on the Wine page. Tap it to take or choose a photo of
 * the label (which then always wins over a picture found online), or to take
 * off a wrong picture.
 */
export function LabelPicture({
  wineId,
  name,
  vintage,
  colour,
}: {
  wineId: string;
  name: string;
  vintage: number | null;
  colour: string | null;
}) {
  const data = useCellarData();
  const toast = useToast();
  const label = data.labels.get(wineId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const pick = async (camera: boolean) => {
    setOpen(false);
    if (!data.accountId) return;
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          toast('Allow the camera in Settings, or choose a photo instead.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
      const res = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (res.canceled || !res.assets?.[0]) return;
      setBusy(true);
      const photo = await shrink(res.assets[0]);
      setPreview(photo.uri);
      await savePhotoLabel(data.accountId, wineId, photo.base64, label?.path ?? null);
      await data.reload();
      toast('Picture saved');
    } catch (e) {
      setPreview(null);
      toast(e instanceof Error ? e.message : 'Couldn’t save the picture.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setOpen(false);
    if (!label) return;
    setBusy(true);
    try {
      await removeLabel(wineId, label.path);
      setPreview(null);
      await data.reload();
      toast('Picture removed');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t remove the picture.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={label ? 'Change the label picture' : 'Add a label picture'}
      >
        <LabelArt
          wineId={wineId}
          uri={preview}
          name={name}
          vintage={vintage}
          colour={colour}
          size="large"
        />
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
      </Pressable>
      {open ? (
        <View style={styles.menu}>
          <MenuItem label="Take a photo of the label" onPress={() => pick(true)} />
          <MenuItem label="Choose a photo" onPress={() => pick(false)} />
          {label ? <MenuItem label="Remove this picture" onPress={remove} /> : null}
          {label?.source === 'web' && label.pageUrl ? (
            <MenuItem
              label="See where it came from"
              onPress={() => {
                setOpen(false);
                Linking.openURL(label.pageUrl as string);
              }}
            />
          ) : null}
          <MenuItem label="Cancel" muted onPress={() => setOpen(false)} />
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button" hitSlop={8}>
          <T variant="caption" style={{ color: colors.accent }}>
            {label ? 'Change picture' : 'Add a picture'}
          </T>
        </Pressable>
      )}
    </View>
  );
}

function MenuItem({
  label,
  onPress,
  muted,
}: {
  label: string;
  onPress: () => void;
  muted?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surface }]}
    >
      <T
        variant="body"
        style={{ color: muted ? colors.textMuted : colors.text, textAlign: 'center' }}
      >
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  busy: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: radius.md,
  },
  menu: {
    alignSelf: 'stretch',
    maxWidth: 320,
    width: '100%',
    marginHorizontal: 'auto',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  item: { paddingVertical: space.md, paddingHorizontal: space.lg },
});
