import { useEffect } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, fonts, radius, space } from '../lib/theme';
import { useVoiceInput } from '../lib/voice';
import { Icon } from './Icon';
import { T } from './ui';

/** Search box with a mic button: type or speak. */
export function SearchBar({
  value,
  onChange,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  /** Enter pressed, or the person finished speaking. */
  onSubmit?: (text: string) => void;
}) {
  const voice = useVoiceInput(onChange, onSubmit);

  useEffect(() => {
    if (!voice.message) return;
    const t = setTimeout(voice.clearMessage, 4000);
    return () => clearTimeout(t);
  }, [voice.message, voice.clearMessage]);

  return (
    <View>
      <View style={styles.box}>
        <View style={{ flexShrink: 0 }}>
          <Icon name="search" size={20} color={colors.textMuted} />
        </View>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={voice.listening ? 'Listening…' : placeholder}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={() => onSubmit?.(value)}
          clearButtonMode="while-editing"
          accessibilityLabel="Search the cellar"
        />
        {value.length > 0 && (
          <Pressable
            onPress={() => onChange('')}
            hitSlop={10}
            accessibilityLabel="Clear search"
            style={styles.iconButton}
          >
            <Icon name="close" size={18} color={colors.textMuted} />
          </Pressable>
        )}
        <Pressable
          onPress={voice.toggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={voice.listening ? 'Stop listening' : 'Search by voice'}
          style={[styles.mic, voice.listening && styles.micOn]}
        >
          <Icon name="mic" size={20} color={voice.listening ? colors.onAccent : colors.accent} />
        </Pressable>
      </View>
      {voice.message ? (
        <T variant="caption" style={styles.message}>
          {voice.message}
        </T>
      ) : null}
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
    paddingLeft: space.md,
    paddingRight: space.xs,
    minHeight: 48,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    paddingVertical: space.md,
    // Removes the browser's focus ring inside the rounded box.
    outlineStyle: 'none',
  } as object,
  iconButton: { padding: space.xs },
  mic: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOn: { backgroundColor: colors.accent },
  message: { marginTop: space.xs, marginLeft: space.xs },
});
