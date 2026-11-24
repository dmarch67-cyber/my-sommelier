import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Voice input for any text box.
 *
 * Web: uses the browser's built-in speech recognition (Chrome and Edge have
 * it; Safari and Firefox mostly don't). Phones: not wired up yet, so the mic
 * says "coming soon". Both cases keep typing working.
 */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => Recognition)
    | null;
}

export function useVoiceInput(
  onText: (text: string) => void,
  /** Called once with the full text when the person stops speaking. */
  onDone?: (text: string) => void,
) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => () => rec.current?.stop(), []);

  const toggle = useCallback(() => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Cls = recognitionClass();
    if (!Cls) {
      setMessage(
        Platform.OS === 'web'
          ? 'This browser can’t take voice input. Try Chrome, or type instead.'
          : 'Voice input is coming in the next build. Type for now.',
      );
      return;
    }
    const r = new Cls();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    let heard = '';
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heard = text.trim();
      onTextRef.current(heard);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') setMessage('Microphone access was blocked in the browser.');
      else if (e.error !== 'aborted' && e.error !== 'no-speech') setMessage('Didn’t catch that.');
    };
    r.onend = () => {
      setListening(false);
      if (heard) onDoneRef.current?.(heard);
    };
    rec.current = r;
    setMessage(null);
    setListening(true);
    r.start();
  }, [listening]);

  return { listening, toggle, message, clearMessage: () => setMessage(null) };
}
