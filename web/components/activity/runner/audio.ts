// Chiptune soundtrack and sound effects for the Activity runner, synthesised with WebAudio.
//
// The game owns the clock: the song is written in beats and scheduled a little ahead of the
// song time the game reports every frame. Notes are placed so they are heard (not merely
// scheduled) when the picture reaches the same song time, using the output timestamp when the
// browser provides one.
//
// Every part of the arrangement (music.ts) is always scheduled, each into the gate of its layer.
// The combo opens and closes the gates: a layer joins on the next beat, so it comes in on the
// grid, and leaves at once when the combo breaks, so a mistake is heard straight away.

import { beatAtTime, BEATS_PER_SECTION, timeAtBeat } from './engine';
import { arrange, chordAt, chordTone, LAYERS, layersFor, STEPS_PER_BEAT, type Layer, type MusicEvent } from './music';

const LOOKAHEAD = 0.18;
const DRIFT_LIMIT = 0.03;
const MASTER_LEVEL = 0.26;
const STEPS_PER_SECTION = BEATS_PER_SECTION * STEPS_PER_BEAT;
/** The echo repeats a dotted eighth later, so it lands between the notes instead of on them. */
const ECHO_BEATS = 0.75;
const LAYER_LEVEL: Record<Layer, number> = { base: 1, groove: 0.9, lead: 1, full: 0.85, fever: 0.8 };

export type RunnerSound = 'jump' | 'perfect' | 'good' | 'offbeat' | 'note' | 'crash' | 'fever' | 'feverEnd';
export type RunnerMix = { combo: number; fever: boolean };

function frequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

type AudioContextConstructor = typeof AudioContext;

function audioContextClass(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function layerMap<T>(make: (layer: Layer) => T) {
  return Object.fromEntries(LAYERS.map((layer) => [layer, make(layer)])) as Record<Layer, T>;
}

/** A pulse wave with the given duty cycle, the classic handheld sound. */
function pulseWave(ctx: BaseAudioContext, duty: number) {
  const harmonics = 32;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n += 1) {
    real[n] = Math.sin(2 * Math.PI * n * duty) / (Math.PI * n);
    imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (Math.PI * n);
  }
  return ctx.createPeriodicWave(real, imag);
}

export class RunnerAudio {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly music: GainNode;
  private readonly effects: GainNode;
  private readonly echo: DelayNode;
  private readonly gates: Record<Layer, GainNode>;
  /** The same gates again, feeding the echo, so a closed layer stops feeding it too. */
  private readonly sends: Record<Layer, GainNode>;
  private readonly noise: AudioBuffer;
  private readonly pulse: PeriodicWave;
  private readonly thinPulse: PeriodicWave;
  private readonly sources = new Set<AudioScheduledSourceNode>();
  private layers = layersFor(0, false);
  private offset: number | null = null;
  private nextStep = 0;
  private beat = 0;
  private echoBeatLength = 0;
  private muted: boolean;

  /** Must be called from a user gesture, or the browser keeps the context suspended. */
  static create(muted: boolean): RunnerAudio | null {
    const Context = audioContextClass();
    if (!Context) return null;
    try {
      return new RunnerAudio(new Context({ latencyHint: 'interactive' }), muted);
    } catch {
      return null;
    }
  }

  private constructor(ctx: AudioContext, muted: boolean) {
    this.ctx = ctx;
    this.muted = muted;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = muted ? 0 : MASTER_LEVEL;
    this.master.connect(compressor);
    this.music = ctx.createGain();
    this.music.gain.value = 0.8;
    this.music.connect(this.master);
    this.effects = ctx.createGain();
    this.effects.gain.value = 4;
    this.effects.connect(this.master);

    // Echo: each repeat a little quieter and darker than the last.
    this.echo = ctx.createDelay(2);
    const darken = ctx.createBiquadFilter();
    darken.type = 'lowpass';
    darken.frequency.value = 2600;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.echo.connect(darken);
    darken.connect(feedback);
    feedback.connect(this.echo);
    darken.connect(wet);
    wet.connect(this.music);

    const gate = (target: AudioNode) => (layer: Layer) => {
      const node = ctx.createGain();
      node.gain.value = this.layers[layer] ? LAYER_LEVEL[layer] : 0;
      node.connect(target);
      return node;
    };
    this.gates = layerMap(gate(this.music));
    this.sends = layerMap(gate(this.echo));

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    this.pulse = pulseWave(ctx, 0.25);
    this.thinPulse = pulseWave(ctx, 0.125);
    void ctx.resume().catch(() => undefined);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, now, 0.03);
  }

  /** Context time that is reaching the speakers right now. */
  private heardNow() {
    const stamp = typeof this.ctx.getOutputTimestamp === 'function' ? this.ctx.getOutputTimestamp() : null;
    if (stamp?.contextTime && stamp.performanceTime) {
      return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
    }
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  /**
   * Schedules the soundtrack up to a moment past the current song time and sets which layers are
   * heard. Called every frame.
   */
  update(songTime: number, mix: RunnerMix) {
    if (this.ctx.state !== 'running') return;
    this.beat = beatAtTime(songTime);
    const offset = this.heardNow() - songTime;
    if (this.offset === null || Math.abs(offset - this.offset) > DRIFT_LIMIT) {
      if (this.offset === null) this.nextStep = Math.ceil(this.beat * STEPS_PER_BEAT);
      this.offset = offset;
    }

    const wanted = layersFor(mix.combo, mix.fever);
    const nextBeat = timeAtBeat(Math.floor(this.beat) + 1) + this.offset;
    for (const layer of LAYERS) {
      if (wanted[layer] !== this.layers[layer]) this.setGate(layer, wanted[layer], nextBeat);
    }

    const beatLength = timeAtBeat(Math.floor(this.beat) + 1) - timeAtBeat(Math.floor(this.beat));
    if (Math.abs(beatLength - this.echoBeatLength) > 0.001) {
      this.echoBeatLength = beatLength;
      this.echo.delayTime.setTargetAtTime(beatLength * ECHO_BEATS, this.ctx.currentTime, 0.05);
    }

    while (timeAtBeat(this.nextStep / STEPS_PER_BEAT) < songTime + LOOKAHEAD) {
      const step = this.nextStep;
      this.nextStep += 1;
      const at = timeAtBeat(step / STEPS_PER_BEAT) + this.offset;
      // Muted or already in the past: keep the pointer moving without making sound.
      if (this.muted || at < this.ctx.currentTime + 0.005) continue;
      this.playStep(step, at);
    }
  }

  /** Silences the soundtrack. The next update starts it again from the current song time. */
  stopMusic() {
    const now = this.ctx.currentTime;
    for (const source of this.sources) {
      try {
        source.stop(now);
      } catch {
        // Already stopped.
      }
    }
    this.sources.clear();
    this.offset = null;
    const bare = layersFor(0, false);
    for (const layer of LAYERS) {
      if (bare[layer] !== this.layers[layer]) this.setGate(layer, bare[layer], now);
    }
  }

  play(sound: RunnerSound) {
    if (this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime + 0.002;
    const chord = chordAt(this.beat);
    // Chord tones from the middle of the keyboard up, so every effect lands in key.
    const tone = (degree: number) => frequency(chordTone(chord, degree));
    const out = [this.effects];
    switch (sound) {
      case 'jump':
        this.blip(this.pulse, tone(6), now, 0.09, 0.06, out, tone(9));
        break;
      case 'perfect':
        this.blip(this.pulse, tone(10), now, 0.05, 0.075, out);
        this.blip(this.pulse, tone(12), now + 0.05, 0.09, 0.075, out);
        break;
      case 'good':
        this.blip(this.pulse, tone(10), now, 0.06, 0.065, out);
        break;
      case 'offbeat':
        this.blip('triangle', frequency(chord.root), now, 0.1, 0.14, out, frequency(chord.root - 5));
        break;
      case 'note':
        [9, 10, 11, 12].forEach((degree, index) => this.blip(this.pulse, tone(degree), now + index * 0.035, 0.05, 0.065, out));
        break;
      case 'crash':
        this.noiseHit(now, 0.55, 0.5, 'lowpass', 3200, out, { sweepTo: 160, music: false });
        this.blip('square', 300, now, 0.42, 0.14, out, 55);
        break;
      case 'fever':
        // A fast run up two octaves of the chord over a rising whoosh.
        for (let degree = 6; degree <= 14; degree += 1) {
          this.blip(this.pulse, tone(degree), now + (degree - 6) * 0.03, 0.07, 0.06, out);
        }
        this.noiseHit(now, 0.4, 0.12, 'bandpass', 900, out, { sweepTo: 7000, music: false });
        break;
      case 'feverEnd':
        [12, 10, 8, 6].forEach((degree, index) => this.blip('triangle', tone(degree), now + index * 0.06, 0.09, 0.09, out));
        break;
    }
  }

  close() {
    this.stopMusic();
    void this.ctx.close().catch(() => undefined);
  }

  private setGate(layer: Layer, on: boolean, at: number) {
    this.layers = { ...this.layers, [layer]: on };
    const now = this.ctx.currentTime;
    for (const node of [this.gates[layer], this.sends[layer]]) {
      const gain = node.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      if (on) {
        gain.setValueAtTime(gain.value, Math.max(now, at));
        gain.linearRampToValueAtTime(LAYER_LEVEL[layer], Math.max(now, at) + 0.012);
      } else {
        gain.setTargetAtTime(0, now, 0.04);
      }
    }
  }

  private playStep(step: number, at: number) {
    for (const event of arrange(step)) this.voice(event, step, at);
  }

  private voice(event: MusicEvent, step: number, at: number) {
    const span = (steps: number) => timeAtBeat((step + steps) / STEPS_PER_BEAT) - timeAtBeat(step / STEPS_PER_BEAT);
    const out = this.gates[event.layer];
    const echoed = [out, this.sends[event.layer]];
    const velocity = event.velocity;
    const hz = frequency(event.midi ?? 69);
    const length = span(event.steps ?? 1);
    switch (event.voice) {
      case 'kick':
        this.kick(at, velocity, out);
        break;
      case 'snare':
        this.snare(at, velocity, out);
        break;
      case 'clap':
        this.clap(at, velocity, out);
        break;
      case 'hat':
        this.noiseHit(at, 0.03, 0.15 * velocity, 'highpass', 8000, [out]);
        break;
      case 'openHat':
        this.noiseHit(at, 0.17, 0.1 * velocity, 'highpass', 6500, [out]);
        break;
      case 'crash':
        this.noiseHit(at, 1.4, 0.2 * velocity, 'highpass', 4200, [out]);
        break;
      case 'tom':
        this.tom(hz, at, velocity, out);
        break;
      case 'bass':
        this.bass(hz, at, length * 0.92, velocity, out);
        break;
      case 'pad':
        this.pad(hz, at, length, velocity, echoed);
        break;
      case 'arp':
        this.arp(hz, at, Math.min(0.12, span(1) * 0.95), velocity, event.bright ?? 1, (event.bright ?? 1) < 1 ? echoed : [out]);
        break;
      case 'lead':
        this.lead(this.pulse, hz, at, length * 0.94, 0.15 * velocity, echoed);
        break;
      case 'harmony':
        this.lead(this.thinPulse, hz, at, length * 0.94, 0.12 * velocity, echoed);
        break;
      case 'sparkle':
        this.sparkle(hz, at, velocity, echoed);
        break;
      case 'riser': {
        // Runs to the last sixteenth before the next section, which is left silent.
        const end = Math.ceil((step + 1) / STEPS_PER_SECTION) * STEPS_PER_SECTION;
        this.riser(at, span(end - step - 1), velocity, out);
        break;
      }
    }
  }

  private track(source: AudioScheduledSourceNode) {
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  private oscillator(wave: OscillatorType | PeriodicWave, hz: number, at: number, stopAt: number, music = true) {
    const node = this.ctx.createOscillator();
    if (typeof wave === 'string') node.type = wave as OscillatorType;
    else node.setPeriodicWave(wave);
    node.frequency.setValueAtTime(hz, at);
    node.start(at);
    node.stop(stopAt);
    if (music) this.track(node);
    return node;
  }

  /** A gain that strikes and dies away, for drums and plucks. */
  private decay(at: number, duration: number, peak: number, destinations: AudioNode[], attack = 0.003) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(duration, attack + 0.01));
    for (const destination of destinations) gain.connect(destination);
    return gain;
  }

  /** A gain that holds for the length of a note, then lets go. */
  private held(at: number, duration: number, peak: number, destinations: AudioNode[], attack = 0.006, release = 0.05) {
    const gain = this.ctx.createGain();
    const end = at + Math.max(duration, attack + 0.01);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.linearRampToValueAtTime(peak * 0.65, end);
    gain.gain.linearRampToValueAtTime(0, end + release);
    for (const destination of destinations) gain.connect(destination);
    return gain;
  }

  private blip(wave: OscillatorType | PeriodicWave, hz: number, at: number, duration: number, peak: number, destinations: AudioNode[], slideTo?: number) {
    const node = this.oscillator(wave, hz, at, at + duration + 0.02, false);
    if (slideTo) node.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    node.connect(this.decay(at, duration, peak, destinations));
  }

  private noiseHit(
    at: number,
    duration: number,
    peak: number,
    type: BiquadFilterType,
    hz: number,
    destinations: AudioNode[],
    { sweepTo, q, music = true }: { sweepTo?: number; q?: number; music?: boolean } = {},
  ) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(hz, at);
    if (q !== undefined) filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + duration);
    source.connect(filter);
    filter.connect(this.decay(at, duration, peak, destinations, 0.002));
    // Start somewhere random in the buffer so repeated hits do not sound identical.
    source.start(at, Math.random() * 0.5);
    source.stop(at + duration + 0.02);
    if (music) this.track(source);
  }

  private kick(at: number, velocity: number, out: AudioNode) {
    const body = this.oscillator('sine', 165, at, at + 0.3);
    body.frequency.exponentialRampToValueAtTime(48, at + 0.11);
    body.connect(this.decay(at, 0.28, 0.6 * velocity, [out], 0.002));
    // A short click on top, so the kick still reads on small speakers.
    const click = this.oscillator('square', 1400, at, at + 0.02);
    click.frequency.exponentialRampToValueAtTime(300, at + 0.012);
    click.connect(this.decay(at, 0.012, 0.08 * velocity, [out], 0.001));
  }

  private snare(at: number, velocity: number, out: AudioNode) {
    this.noiseHit(at, 0.15, 0.32 * velocity, 'bandpass', 1900, [out], { q: 0.7 });
    const body = this.oscillator('triangle', 220, at, at + 0.09);
    body.frequency.exponentialRampToValueAtTime(170, at + 0.07);
    body.connect(this.decay(at, 0.07, 0.22 * velocity, [out]));
  }

  private clap(at: number, velocity: number, out: AudioNode) {
    // Three quick slaps and a short tail, the way a handclap smears.
    for (let slap = 0; slap < 3; slap += 1) {
      this.noiseHit(at + slap * 0.011, 0.012, 0.3 * velocity, 'bandpass', 1300, [out], { q: 1.2 });
    }
    this.noiseHit(at + 0.033, 0.12, 0.24 * velocity, 'bandpass', 1300, [out], { q: 1.2 });
  }

  private tom(hz: number, at: number, velocity: number, out: AudioNode) {
    const body = this.oscillator('triangle', hz * 1.6, at, at + 0.22);
    body.frequency.exponentialRampToValueAtTime(hz, at + 0.08);
    body.connect(this.decay(at, 0.2, 0.38 * velocity, [out]));
  }

  private bass(hz: number, at: number, duration: number, velocity: number, out: AudioNode) {
    const stopAt = at + duration + 0.05;
    // A square through a resonant filter that snaps shut, with a triangle under it for weight.
    const wave = this.oscillator('square', hz, at, stopAt);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(2200, at);
    filter.frequency.exponentialRampToValueAtTime(520, at + 0.12);
    wave.connect(filter);
    filter.connect(this.held(at, duration, 0.12 * velocity, [out], 0.004, 0.03));
    const sub = this.oscillator('triangle', hz, at, stopAt);
    sub.connect(this.held(at, duration, 0.16 * velocity, [out], 0.004, 0.03));
  }

  private pad(hz: number, at: number, duration: number, velocity: number, destinations: AudioNode[]) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    filter.connect(this.held(at, duration, 0.05 * velocity, destinations, 0.14, 0.35));
    // Two saws a hair apart, so the chord shimmers.
    for (const detune of [-8, 8]) {
      const wave = this.oscillator('sawtooth', hz, at, at + duration + 0.4);
      wave.detune.value = detune;
      wave.connect(filter);
    }
  }

  private arp(hz: number, at: number, duration: number, velocity: number, bright: number, destinations: AudioNode[]) {
    const wave = this.oscillator(this.pulse, hz, at, at + duration + 0.02);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    filter.frequency.value = 500 + bright * bright * 6000;
    wave.connect(filter);
    filter.connect(this.decay(at, duration, 0.26 * velocity, destinations));
  }

  private lead(wave: PeriodicWave, hz: number, at: number, duration: number, peak: number, destinations: AudioNode[]) {
    const node = this.oscillator(wave, hz, at, at + duration + 0.08);
    // Long notes get a vibrato that eases in after the attack.
    if (duration > 0.25) {
      const lfo = this.oscillator('sine', 5.5, at, at + duration + 0.08);
      const depth = this.ctx.createGain();
      depth.gain.setValueAtTime(0, at);
      depth.gain.linearRampToValueAtTime(0, at + 0.12);
      depth.gain.linearRampToValueAtTime(14, at + Math.min(duration, 0.4));
      lfo.connect(depth);
      depth.connect(node.detune);
    }
    node.connect(this.held(at, duration, peak, destinations));
  }

  private sparkle(hz: number, at: number, velocity: number, destinations: AudioNode[]) {
    // A small bell: the note and its octave, struck and let ring.
    for (const [ratio, level] of [[1, 1], [2, 0.4]]) {
      const wave = this.oscillator('sine', hz * ratio, at, at + 0.2);
      wave.connect(this.decay(at, 0.18, 0.1 * velocity * level, destinations, 0.002));
    }
  }

  private riser(at: number, duration: number, velocity: number, out: AudioNode) {
    const end = at + duration;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(350, at);
    filter.frequency.exponentialRampToValueAtTime(5500, end);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16 * velocity, end);
    gain.gain.linearRampToValueAtTime(0, end + 0.01);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(at);
    source.stop(end + 0.02);
    this.track(source);

    const tone = this.oscillator('sawtooth', 220, at, end + 0.02);
    tone.frequency.exponentialRampToValueAtTime(880, end);
    const toneFilter = this.ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 1800;
    tone.connect(toneFilter);
    const toneGain = this.ctx.createGain();
    toneGain.gain.setValueAtTime(0.0001, at);
    toneGain.gain.exponentialRampToValueAtTime(0.035 * velocity, end);
    toneGain.gain.linearRampToValueAtTime(0, end + 0.01);
    toneFilter.connect(toneGain);
    toneGain.connect(out);
  }
}
