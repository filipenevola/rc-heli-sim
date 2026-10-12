/**
 * The instructor's voice: browser speech synthesis reading lesson captions and emergency warnings aloud, so the
 * eyes stay on the helicopter. No audio assets; whatever voice the device has for the current language.
 */
export class Voice {
  enabled = true;
  private last = '';
  private lastAt = 0;

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /** Say something; the same sentence is not repeated within a few seconds; a new sentence cuts the previous one. */
  say(text: string, lang: 'en' | 'pt-BR', urgent = false): void {
    if (!this.enabled || !this.supported || !text) return;
    const now = Date.now();
    if (text === this.last && now - this.lastAt < 4000) return;
    this.last = text;
    this.lastAt = now;
    try {
      const synth = window.speechSynthesis;
      if (urgent || synth.speaking) synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').trim());
      u.lang = lang === 'pt-BR' ? 'pt-BR' : 'en-US';
      u.rate = 1.05;
      const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang === 'pt-BR' ? 'pt' : 'en'));
      if (voice) u.voice = voice;
      synth.speak(u);
    } catch {
      /* no voice on this device */
    }
  }

  stop(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }
}
