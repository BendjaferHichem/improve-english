// Canvas waveform. What it draws is driven by real signals only:
//  - listening: the microphone's actual frequency data (AnalyserNode)
//  - speaking:  word-boundary events from the speech synthesizer (steady wave if the voice sends none)
//  - processing: a slow sweep while we wait for the AI
//  - idle: a flat line
const BARS = 36;

export class Waveform {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'idle';
    this.analyser = null;
    this.data = null;
    this.energy = 0;
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._resize();
    addEventListener('resize', () => this._resize());
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'listening') this.analyser = null;
    this.energy = mode === 'speaking' ? 0.35 : 0;
  }

  attachAnalyser(analyser) {
    this.analyser = analyser;
    this.data = new Uint8Array(analyser.frequencyBinCount);
  }

  pulse() { this.energy = 1; }

  _resize() {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.w = width;
    this.h = height;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  _levels(t) {
    const out = new Array(BARS).fill(0.04);
    if (this.mode === 'listening' && this.analyser) {
      this.analyser.getByteFrequencyData(this.data);
      const usable = Math.floor(this.data.length * 0.7);
      for (let i = 0; i < BARS; i++) out[i] = Math.max(0.04, this.data[Math.floor((i / BARS) * usable)] / 255);
    } else if (this.mode === 'listening') {
      out.fill(0.1); // no analyser available: a quiet, honest baseline
    } else if (this.mode === 'speaking') {
      this.energy = Math.max(0.35, this.energy * 0.94);
      for (let i = 0; i < BARS; i++) out[i] = 0.08 + this.energy * 0.55 * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.6 + t / 220)));
    } else if (this.mode === 'processing') {
      const head = ((t / 900) % 1) * BARS;
      for (let i = 0; i < BARS; i++) out[i] = 0.05 + 0.3 * Math.max(0, 1 - Math.abs(i - head) / 4);
    }
    return out;
  }

  _loop(t) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const style = getComputedStyle(this.canvas);
    ctx.fillStyle = this.mode === 'listening' ? style.getPropertyValue('--wave-user') : style.getPropertyValue('--wave-ai');
    const levels = this._levels(this.reduceMotion ? 0 : t);
    const gap = 4;
    const bar = (w - gap * (BARS - 1)) / BARS;
    levels.forEach((level, i) => {
      const barHeight = Math.max(3, level * h);
      const x = i * (bar + gap);
      ctx.beginPath();
      ctx.roundRect(x, (h - barHeight) / 2, bar, barHeight, bar / 2);
      ctx.fill();
    });
    requestAnimationFrame(this._loop);
  }
}
