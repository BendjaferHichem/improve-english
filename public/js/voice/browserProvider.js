// Browser voice provider: Web Speech API for recognition (STT) and synthesis (TTS).
// Free, but quality depends on the browser and the voices installed on the device.
export class VoiceError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

export function splitSentences(text) {
  const parts = text.match(/[^.!?…]+[.!?…]+["')\]]*|\S[^.!?…]*$/g) || [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

export function loadVoices() {
  return new Promise((resolve) => {
    if (!synth) return resolve([]);
    const english = () => synth.getVoices().filter((v) => /^en/i.test(v.lang));
    if (english().length) return resolve(english());
    const done = () => { synth.removeEventListener('voiceschanged', done); resolve(english()); };
    synth.addEventListener('voiceschanged', done);
    setTimeout(done, 1500);
  });
}

// Prefer neural/online voices when the browser offers them.
export function pickDefaultVoice(voices) {
  const score = (v) =>
    (/natural|neural|online/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0) +
    (/^en-US/i.test(v.lang) ? 1 : /^en-GB/i.test(v.lang) ? 0.5 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0] || null;
}

const STT_ERRORS = {
  'not-allowed': 'mic-denied', 'service-not-allowed': 'mic-denied', 'audio-capture': 'mic-unavailable',
  network: 'stt-network',
};

export class BrowserVoiceProvider {
  constructor() {
    this.capabilities = { stt: Boolean(Recognition), tts: Boolean(synth), streaming: false, bargeIn: false };
    this._token = 0;
    this._cancel = null;
    this._finishNow = null;
  }

  // iOS Safari only allows speech that starts inside a user gesture; call this from a click handler.
  unlockSpeech() {
    if (synth) synth.speak(new SpeechSynthesisUtterance(''));
  }

  // Resolves with { transcript, speechMs } after the learner stops talking.
  // Rejects with VoiceError: no-speech, aborted, mic-denied, ...
  listen({ onInterim, lang = 'en-US', silenceMs = 1700, initialSilenceMs = 9000 } = {}) {
    if (!Recognition) return Promise.reject(new VoiceError('stt-unsupported'));
    this.abortListening();
    synth?.cancel();

    return new Promise((resolve, reject) => {
      const rec = new Recognition();
      rec.lang = lang;
      rec.continuous = true;      // we decide when the learner is done, so slow speakers aren't cut off
      rec.interimResults = true;
      let text = '';
      let firstAt = 0;
      let lastAt = 0;
      let timer = null;
      let settled = false;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._cancel = this._finishNow = null;
        try { rec.stop(); } catch { /* already stopped */ }
        if (error) reject(error);
        else if (!text.trim()) reject(new VoiceError('no-speech'));
        else resolve({ transcript: text.trim(), speechMs: Math.round(lastAt - firstAt) });
      };
      const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => finish(), ms); };

      rec.onstart = () => arm(initialSilenceMs);
      rec.onresult = (event) => {
        const now = performance.now();
        firstAt ||= now;
        lastAt = now;
        text = Array.from(event.results).map((r) => r[0].transcript).join(' ').replace(/\s+/g, ' ');
        onInterim?.(text);
        arm(silenceMs);
      };
      rec.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return; // onend will settle it
        finish(new VoiceError(STT_ERRORS[event.error] || 'stt-failed'));
      };
      rec.onend = () => finish();

      this._cancel = () => finish(new VoiceError('aborted'));
      this._finishNow = () => finish();
      try { rec.start(); } catch { finish(new VoiceError('stt-start-failed')); }
    });
  }

  finishListening() { this._finishNow?.(); }
  abortListening() { this._cancel?.(); }

  async speak(text, { voiceName, rate = 1, onSentence, onBoundary } = {}) {
    if (!synth) throw new VoiceError('tts-unsupported');
    this.stopSpeaking();
    const token = ++this._token;
    const voices = await loadVoices();
    if (token !== this._token) return;
    const voice = voices.find((v) => v.name === voiceName) || pickDefaultVoice(voices);

    const sentences = splitSentences(text);
    for (let i = 0; i < sentences.length; i++) {
      if (token !== this._token) return;
      onSentence?.(i);
      await this._speakChunk(sentences[i], { voice, rate, onBoundary });
    }
  }

  // One sentence per utterance: avoids Chrome cutting off long utterances and lets captions follow along.
  _speakChunk(text, { voice, rate, onBoundary }) {
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = voice?.lang || 'en-US';
      if (voice) utterance.voice = voice;
      utterance.rate = rate;

      let done = false;
      let watchdog;
      const end = (error) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        error ? reject(error) : resolve();
      };
      // Some browsers never fire onend; don't let the conversation hang.
      watchdog = setTimeout(() => { synth.cancel(); end(); }, Math.max(4000, (text.split(/\s+/).length * 700) / rate));

      utterance.onboundary = () => onBoundary?.();
      utterance.onend = () => end();
      utterance.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? end() : end(new VoiceError('tts-failed')));
      synth.speak(utterance);
    });
  }

  stopSpeaking() {
    this._token++;
    synth?.cancel();
  }
}
