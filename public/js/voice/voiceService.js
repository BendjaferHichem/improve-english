// VoiceService: the only voice API the rest of the app uses.
// To change providers, implement the provider interface (see browserProvider.js) and register it below:
//   listen(opts) -> Promise<{transcript, speechMs}>, finishListening(), abortListening(),
//   speak(text, opts) -> Promise, stopSpeaking(), unlockSpeech(), capabilities
import { BrowserVoiceProvider, VoiceError, splitSentences } from './browserProvider.js';

export { VoiceError, splitSentences };

const PROVIDERS = {
  browser: () => new BrowserVoiceProvider(),
  // deepgram: () => new DeepgramProvider(), ...
};

export class VoiceService {
  static create(speechConfig) {
    const make = PROVIDERS[speechConfig?.provider] || PROVIDERS.browser;
    return new VoiceService(make());
  }

  constructor(provider) {
    this.provider = provider;
    this._meter = null;
    this._meterToken = 0;
  }

  get capabilities() { return this.provider.capabilities; }

  // Call from a click handler. Checks support and microphone permission up front.
  async startConversation() {
    this.provider.unlockSpeech?.();
    if (!this.capabilities.stt) throw new VoiceError('stt-unsupported');
    if (!this.capabilities.tts) throw new VoiceError('tts-unsupported');
    if (!navigator.mediaDevices?.getUserMedia) throw new VoiceError('mic-unavailable');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      throw new VoiceError(err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'mic-denied' : 'mic-unavailable');
    }
  }

  // Microphone -> text. With the browser provider this is live recognition.
  transcribeAudio(opts) { return this.provider.listen(opts); }
  finishListening() { this.provider.finishListening(); }

  // Text -> speech.
  synthesizeSpeech(text, opts) { return this.provider.speak(text, opts); }
  stopSpeaking() { this.provider.stopSpeaking(); }

  // Tap-to-interrupt. True voice barge-in needs streaming STT with echo cancellation (see README).
  interrupt() {
    this.provider.stopSpeaking();
    this.provider.abortListening();
    this.closeLevelMeter();
  }

  endConversation() { this.interrupt(); }

  // Real microphone level for the waveform. Best effort: returns null if unavailable.
  async openLevelMeter() {
    this.closeLevelMeter();
    const token = ++this._meterToken;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (token !== this._meterToken) { stream.getTracks().forEach((t) => t.stop()); return null; }
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this._meter = { stream, ctx };
      return analyser;
    } catch {
      return null;
    }
  }

  closeLevelMeter() {
    this._meterToken++;
    if (!this._meter) return;
    this._meter.stream.getTracks().forEach((t) => t.stop());
    this._meter.ctx.close().catch(() => {});
    this._meter = null;
  }
}
