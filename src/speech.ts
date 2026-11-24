// Read explanations aloud with the browser's speechSynthesis. Owned by T4.
// Every function is a no-op when the API is missing (old browsers, tests, SSR).

export type SpeechLang = 'hi-IN' | 'en-IN' | (string & {});

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

export function isSpeechSupported(): boolean {
  return synth() !== null && typeof SpeechSynthesisUtterance !== 'undefined';
}

const norm = (l: string) => l.replace('_', '-').toLowerCase();

/**
 * Pick a voice: exact `lang` first, then the other Indian locale (hi-IN / en-IN),
 * then any voice with the same base language. Returns null to use the browser default.
 */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const want = norm(lang);
  const order = [want, 'hi-in', 'en-in'];
  for (const l of order) {
    const v = voices.find((x) => norm(x.lang) === l);
    if (v) return v;
  }
  const base = want.split('-')[0];
  return voices.find((x) => norm(x.lang).split('-')[0] === base) ?? null;
}

/** Speak `text`, replacing anything already being spoken. Hinglish reads best with `hi-IN`. */
export function speak(text: string, lang: SpeechLang = 'hi-IN'): void {
  const s = synth();
  if (!s || typeof SpeechSynthesisUtterance === 'undefined' || !text.trim()) return;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(s.getVoices(), lang);
    u.lang = voice?.lang ?? lang;
    if (voice) u.voice = voice;
    u.rate = 0.95;
    s.speak(u);
  } catch {
    // Speech is a nice-to-have; never break the practice screen.
  }
}

export function stopSpeaking(): void {
  try {
    synth()?.cancel();
  } catch {
    // ignore
  }
}
