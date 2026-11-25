import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type * as ImagePicker from 'expo-image-picker';

/** Claude reads labels best at up to about 1,500 pixels on the long side; bigger only costs more. */
export const MAX_SIDE = 1568;

/** A JPEG of the photo, at most MAX_SIDE pixels on its long side. */
export async function shrink(
  asset: ImagePicker.ImagePickerAsset,
): Promise<{ uri: string; base64: string }> {
  const long = Math.max(asset.width || 0, asset.height || 0);
  const actions =
    long > MAX_SIDE
      ? [{ resize: asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE } }]
      : [];
  const out = await manipulateAsync(asset.uri, actions, {
    compress: 0.8,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new Error('Could not read that photo.');
  return { uri: out.uri, base64: out.base64.replace(/^data:[^,]*,/, '') };
}
