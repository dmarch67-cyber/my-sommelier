import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radius, space } from '../lib/theme';

type ToastAction = { label: string; onPress: () => void | Promise<void> };
type ToastState = { message: string; action?: ToastAction; id: number } | null;

const Ctx = createContext<(message: string, action?: ToastAction) => void>(() => {});

/** A message at the bottom of the screen, with an optional button such as Undo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback((message: string, action?: ToastAction) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    setToast({ message, action, id });
    // Long enough to reach Undo.
    timer.current = setTimeout(
      () => setToast((t) => (t?.id === id ? null : t)),
      action ? 10000 : 4000,
    );
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 84 }]}>
          <View style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text style={styles.text}>{toast.message}</Text>
            {toast.action && (
              <Pressable
                onPress={async () => {
                  const a = toast.action!;
                  setToast(null);
                  await a.onPress();
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={styles.action}>{toast.action.label}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    maxWidth: 560,
    width: '100%',
  },
  text: { flex: 1, color: colors.onAccent, fontFamily: fonts.medium, fontSize: 15 },
  action: { color: '#F2B8C9', fontFamily: fonts.bold, fontSize: 15 },
});
