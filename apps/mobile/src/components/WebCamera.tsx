import { createElement, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { colors, radius, space } from '../lib/theme';
import { Button, T } from './ui';

/**
 * True on a desktop browser with a camera API. Phones' browsers already open
 * their own camera from the photo picker, so they keep using that.
 */
export function canUseWebcam(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return !mobile;
}

/** A live webcam view with a Snap button (web only). Returns the photo as JPEG base64. */
export function WebCamera({
  maxSide,
  onSnap,
  onCancel,
  onError,
}: {
  maxSide: number;
  onSnap: (photo: { uri: string; base64: string }) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
      })
      .catch((e: unknown) => {
        const name = e instanceof Error ? e.name : '';
        onError(
          name === 'NotAllowedError'
            ? 'The browser blocked the camera. Click the camera icon in the address bar to allow it, or choose a photo instead.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera was found on this computer. Choose a photo instead.'
              : 'The camera couldn’t start. Choose a photo instead.',
        );
      });
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const uri = canvas.toDataURL('image/jpeg', 0.85);
    onSnap({ uri, base64: uri.replace(/^data:[^,]*,/, '') });
  };

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.frame}>
        {createElement('video', {
          ref: video,
          autoPlay: true,
          playsInline: true,
          muted: true,
          'aria-label': 'Camera view',
          onLoadedData: () => setReady(true),
          style: { width: '100%', height: '100%', objectFit: 'contain', background: '#000' },
        })}
      </View>
      <T variant="caption">
        Hold the front label up to the camera so it fills most of the picture.
      </T>
      <Button label={ready ? 'Snap' : 'Starting the camera…'} onPress={snap} disabled={!ready} />
      <Button label="Cancel" kind="secondary" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.text,
  },
});
