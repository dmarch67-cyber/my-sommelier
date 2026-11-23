import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { colors, fonts, radius, space } from '../lib/theme';
import { useVoiceInput } from '../lib/voice';
import { Icon } from './Icon';
import { T } from './ui';

/**
 * A text box with a mic: type, or tap the mic and speak. Speech is added
 * after what is already there (so a note can be built up in pieces).
 */
export function VoiceField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
  voice = true,
  autoFocus,
  accessibilityLabel,
}: {
  label?: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  voice?: boolean;
  autoFocus?: boolean;
  accessibilityLabel?: string;
}) {
  const base = useRef('');
  const mic = useVoiceInput((spoken) =>
    onChange(base.current ? `${base.current} ${spoken}` : spoken),
  );

  useEffect(() => {
    if (!mic.message) return;
    const t = setTimeout(mic.clearMessage, 4000);
    return () => clearTimeout(t);
  }, [mic.message, mic.clearMessage]);

  return (
    <View style={{ gap: space.xs }}>
      {label ? <T variant="overline">{label}</T> : null}
      <View style={[styles.box, multiline && styles.boxMulti]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={mic.listening ? 'Listening…' : placeholder}
          placeholderTextColor={colors.textFaint}
          style={[styles.input, multiline && styles.inputMulti]}
          multiline={multiline}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
        />
        {voice && (
          <Pressable
            onPress={() => {
              base.current = mic.listening ? base.current : value.trim();
              mic.toggle();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={mic.listening ? 'Stop listening' : 'Speak instead of typing'}
            style={[styles.mic, mic.listening && styles.micOn]}
          >
            <Icon name="mic" size={20} color={mic.listening ? colors.onAccent : colors.accent} />
          </Pressable>
        )}
      </View>
      {mic.message ? <T variant="caption">{mic.message}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    minHeight: 50,
  },
  boxMulti: { alignItems: 'flex-start', paddingTop: space.xs },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    paddingVertical: space.md,
    outlineStyle: 'none',
  } as object,
  inputMulti: { minHeight: 88, textAlignVertical: 'top' } as object,
  mic: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOn: { backgroundColor: colors.accent },
});
