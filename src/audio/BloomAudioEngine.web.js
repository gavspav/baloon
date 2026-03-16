const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export class BloomAudioEngine {
  constructor() {
    this.voices = new Map();
    this.mode = 'fm-synth';
    this.ctx = null;
    this.masterGain = null;
    this._unlocked = false;
  }

  _ensureContext() {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.45;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (!this._unlocked) {
      this._unlockiOS();
    }
    return this.ctx;
  }

  _unlockiOS() {
    this._unlocked = true;
    const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start(0);
    src.stop(this.ctx.currentTime + 0.001);
  }

  triggerVoice(descriptor, held = true) {
    const ctx = this._ensureContext();
    const now = ctx.currentTime;

    const pitchHz = Number(descriptor.pitchHz) || 440;
    const filterHz = clamp(Number(descriptor.filterHz) || 2000, 80, 12000);
    const fmDepth = clamp(Number(descriptor.fmDepth) || 0.8, 0.2, 6);
    const attackSec = Math.max(0.04, (Number(descriptor.attackMs) || 80) / 1000);

    // --- Modulator oscillator (FM source) ---
    const modOsc = ctx.createOscillator();
    const modGain = ctx.createGain();
    modOsc.type = 'sine';
    modOsc.frequency.setValueAtTime(pitchHz * 1.5, now);
    modGain.gain.setValueAtTime(pitchHz * fmDepth, now);

    // --- Carrier oscillator ---
    const carrierOsc = ctx.createOscillator();
    carrierOsc.type = 'sine';
    carrierOsc.frequency.setValueAtTime(pitchHz, now);

    // --- Lowpass filter ---
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterHz, now);
    filter.Q.setValueAtTime(0.7, now);

    // --- Amplitude envelope ---
    const ampEnv = ctx.createGain();
    ampEnv.gain.setValueAtTime(0.001, now);
    ampEnv.gain.exponentialRampToValueAtTime(0.16, now + attackSec);

    if (held) {
      // Sustain indefinitely until releaseHeldVoice is called
      ampEnv.gain.setValueAtTime(0.14, now + attackSec + 0.01);
    } else {
      // Auto-release for non-held voices
      const releaseSec = Math.max(0.15, (Number(descriptor.releaseMs) || 400) / 1000);
      const noteLenSec = Math.max(0.05, (Number(descriptor.noteLengthMs) || 300) / 1000);
      const sustainEnd = now + attackSec + noteLenSec;
      const endTime = sustainEnd + releaseSec;
      ampEnv.gain.exponentialRampToValueAtTime(0.12, sustainEnd);
      ampEnv.gain.exponentialRampToValueAtTime(0.001, endTime);
      modOsc.stop(endTime + 0.05);
      carrierOsc.stop(endTime + 0.05);
    }

    // --- Routing ---
    modOsc.connect(modGain);
    modGain.connect(carrierOsc.frequency);
    carrierOsc.connect(filter);
    filter.connect(ampEnv);
    ampEnv.connect(this.masterGain);

    // --- Start oscillators ---
    modOsc.start(now);
    carrierOsc.start(now);

    this.voices.set(descriptor.id, {
      id: descriptor.id,
      pitchHz,
      modOsc,
      modGain,
      carrierOsc,
      filter,
      ampEnv,
      held,
      released: false,
    });

    return this.getStatus();
  }

  updateVoice(id, patch) {
    const voice = this.voices.get(id);
    if (!voice || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (patch.filterHz != null && voice.filter) {
      voice.filter.frequency.setValueAtTime(
        clamp(Number(patch.filterHz), 80, 12000),
        now,
      );
    }
    if (patch.fmDepth != null && voice.modGain) {
      voice.modGain.gain.setValueAtTime(
        voice.pitchHz * clamp(Number(patch.fmDepth), 0.5, 20),
        now,
      );
    }
  }

  extendVoice(id, pressMetrics) {
    const voice = this.voices.get(id);
    if (!voice || !this.ctx || voice.released) return;
    const now = this.ctx.currentTime;

    try {
      voice.ampEnv.gain.cancelScheduledValues(now);
      voice.ampEnv.gain.setValueAtTime(voice.ampEnv.gain.value || 0.12, now);
      voice.ampEnv.gain.linearRampToValueAtTime(0.14, now + 0.05);
    } catch (_) { /* voice may have ended */ }

    voice.pressMetrics = pressMetrics;
  }

  releaseHeldVoice(id, pressMetrics) {
    const voice = this.voices.get(id);
    if (!voice || !this.ctx || voice.released) return;
    const now = this.ctx.currentTime;

    voice.released = true;
    const releaseSec = Math.max(0.15, (Number(pressMetrics.releaseMs) || 400) / 1000);
    const endTime = now + releaseSec;

    try {
      voice.ampEnv.gain.cancelScheduledValues(now);
      voice.ampEnv.gain.setValueAtTime(voice.ampEnv.gain.value || 0.12, now);
      voice.ampEnv.gain.exponentialRampToValueAtTime(0.001, endTime);

      voice.modOsc.stop(endTime + 0.05);
      voice.carrierOsc.stop(endTime + 0.05);
    } catch (_) { /* voice may have ended */ }
  }

  releaseVoice(id) {
    this.voices.delete(id);
  }

  releaseMissing(activeVoiceIds = []) {
    const activeSet = new Set(activeVoiceIds);
    for (const id of Array.from(this.voices.keys())) {
      if (!activeSet.has(id)) this.voices.delete(id);
    }
  }

  releaseAll() {
    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (const voice of this.voices.values()) {
        try {
          voice.ampEnv.gain.cancelScheduledValues(now);
          voice.ampEnv.gain.setValueAtTime(0.001, now);
        } catch (_) { /* voice already ended */ }
      }
    }
    this.voices.clear();
  }

  getStatus() {
    return {
      mode: this.mode,
      activeVoices: this.voices.size,
    };
  }
}
