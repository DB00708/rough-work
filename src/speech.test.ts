import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSpeechSupported, pickVoice, speak, stopSpeaking } from './speech';

const v = (lang: string) => ({ lang, name: lang }) as SpeechSynthesisVoice;

class FakeUtterance {
  lang = '';
  voice: unknown = null;
  rate = 1;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

describe('speech', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a no-op without speechSynthesis', () => {
    expect(isSpeechSupported()).toBe(false);
    expect(() => speak('namaste', 'hi-IN')).not.toThrow();
    expect(() => stopSpeaking()).not.toThrow();
  });

  it('prefers the exact locale, then hi-IN/en-IN, then same base language', () => {
    const voices = [v('en-US'), v('en-IN'), v('hi-IN')];
    expect(pickVoice(voices, 'hi-IN')?.lang).toBe('hi-IN');
    expect(pickVoice(voices, 'en-IN')?.lang).toBe('en-IN');
    expect(pickVoice([v('en-US'), v('en-IN')], 'hi-IN')?.lang).toBe('en-IN');
    expect(pickVoice([v('en_GB'), v('fr-FR')], 'en-AU')?.lang).toBe('en_GB');
    expect(pickVoice([v('fr-FR')], 'hi-IN')).toBeNull();
  });

  it('cancels, then speaks with the chosen voice', () => {
    const synth = { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [v('en-US'), v('hi-IN')] };
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    expect(isSpeechSupported()).toBe(true);
    speak('Line 2 mein sign galat hai', 'hi-IN');
    expect(synth.cancel).toHaveBeenCalled();
    const u = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(u.text).toBe('Line 2 mein sign galat hai');
    expect(u.lang).toBe('hi-IN');
    speak('   ');
    expect(synth.speak).toHaveBeenCalledTimes(1);
    stopSpeaking();
    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });
});
