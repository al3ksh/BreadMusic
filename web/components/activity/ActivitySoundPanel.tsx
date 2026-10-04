import { AudioWaveform, Gauge, Mic2, Orbit, Radio, RotateCcw, Rabbit, Snail, Sparkles, Speaker, Waves } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SoundState } from '@/lib/api';

const SOUND_PRESETS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'bassboost', label: 'Bass boost', icon: Speaker },
  { value: 'nightcore', label: 'Nightcore', icon: Rabbit },
  { value: 'vaporwave', label: 'Vaporwave', icon: Snail },
  { value: '8d', label: '8D', icon: Orbit },
  { value: 'karaoke', label: 'Karaoke', icon: Mic2 },
  { value: 'radio', label: 'Radio', icon: Radio },
  { value: 'soft', label: 'Soft', icon: Sparkles },
  { value: 'vibrato', label: 'Vibrato', icon: AudioWaveform },
  { value: 'tremolo', label: 'Tremolo', icon: Waves },
];

const EQ_BANDS = ['Sub', 'Bass', 'Low-mid', 'Mid', 'Presence', 'Air'];
const EQ_RANGE = 6;
const SEND_DELAY_MS = 320;

export const DEFAULT_SOUND: SoundState = { preset: null, eq: [0, 0, 0, 0, 0, 0], speed: 1, pitch: 1 };

function sameSound(a: SoundState, b: SoundState) {
  return a.preset === b.preset && a.speed === b.speed && a.pitch === b.pitch && a.eq.every((value, index) => value === b.eq[index]);
}

function formatDb(value: number) {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${value}`;
}

type ActivitySoundPanelProps = {
  sound: SoundState | undefined;
  canEdit: boolean;
  onChange: (sound: SoundState) => Promise<boolean>;
};

// Edits stay local while the user drags and are sent at most every SEND_DELAY_MS, so the
// SSE status echo can't yank a slider back mid-gesture.
export function ActivitySoundPanel({ sound, canEdit, onChange }: ActivitySoundPanelProps) {
  const remote = sound ?? DEFAULT_SOUND;
  const [draft, setDraft] = useState<SoundState | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<SoundState | null>(null);
  const inFlightRef = useRef(false);
  const value = draft ?? remote;

  const flush = useCallback(async () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const next = pendingRef.current;
    if (!next || inFlightRef.current) return;
    pendingRef.current = null;
    inFlightRef.current = true;
    await onChange(next);
    inFlightRef.current = false;
    if (pendingRef.current) {
      void flush();
      return;
    }
    setDraft(null);
  }, [onChange]);

  const update = useCallback((next: SoundState, immediate = false) => {
    if (!canEdit) return;
    setDraft(next);
    pendingRef.current = next;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (immediate) void flush();
    else timerRef.current = window.setTimeout(() => void flush(), SEND_DELAY_MS);
  }, [canEdit, flush]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const setBand = (index: number, gain: number) => {
    const eq = value.eq.map((current, bandIndex) => (bandIndex === index ? gain : current));
    update({ ...value, eq });
  };

  const isDefault = sameSound(value, DEFAULT_SOUND);

  return (
    <div className="activity-sound-panel">
      {!canEdit && <p className="activity-sound-readonly">Only DJs can change the sound. You are seeing the current settings.</p>}

      <section aria-label="Presets">
        <div className="activity-sound-heading"><span>Presets</span></div>
        <div className="activity-sound-presets">
          {SOUND_PRESETS.map(({ value: preset, label, icon: Icon }, index) => {
            const active = value.preset === preset;
            return (
              <button
                key={preset}
                type="button"
                className={`activity-sound-preset${active ? ' is-active' : ''}`}
                style={{ '--stagger-index': index } as CSSProperties}
                aria-pressed={active}
                disabled={!canEdit}
                onClick={() => update({ ...value, preset: active ? null : preset }, true)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Equalizer">
        <div className="activity-sound-heading"><span>Equalizer</span><small>dB</small></div>
        <div className="activity-sound-eq">
          {EQ_BANDS.map((label, index) => {
            const gain = value.eq[index] ?? 0;
            return (
              <label key={label} className="activity-sound-band">
                <output className={gain === 0 ? '' : 'is-changed'}>{formatDb(gain)}</output>
                <input
                  type="range"
                  min={-EQ_RANGE}
                  max={EQ_RANGE}
                  step={0.5}
                  value={gain}
                  disabled={!canEdit}
                  onChange={(event) => setBand(index, Number(event.target.value))}
                  onPointerUp={() => void flush()}
                  onDoubleClick={() => setBand(index, 0)}
                  style={{ '--range-progress': `${((gain + EQ_RANGE) / (EQ_RANGE * 2)) * 100}%` } as CSSProperties}
                  aria-label={`${label} ${formatDb(gain)} dB`}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section aria-label="Tempo" className="activity-sound-tempo">
        <TempoSlider
          icon={Gauge}
          label="Speed"
          value={value.speed}
          disabled={!canEdit}
          onChange={(speed) => update({ ...value, speed })}
          onCommit={() => void flush()}
        />
        <TempoSlider
          icon={AudioWaveform}
          label="Pitch"
          value={value.pitch}
          disabled={!canEdit}
          onChange={(pitch) => update({ ...value, pitch })}
          onCommit={() => void flush()}
        />
      </section>

      <button
        type="button"
        className="activity-sound-reset"
        disabled={!canEdit || isDefault}
        onClick={() => update(DEFAULT_SOUND, true)}
      >
        <RotateCcw size={15} /> Reset sound
      </button>
    </div>
  );
}

function TempoSlider({
  icon: Icon,
  label,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="activity-sound-tempo-row">
      <span><Icon size={15} /> {label}</span>
      <input
        type="range"
        min={0.5}
        max={2}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Math.round(Number(event.target.value) * 100) / 100)}
        onPointerUp={onCommit}
        onDoubleClick={() => onChange(1)}
        style={{ '--range-progress': `${((value - 0.5) / 1.5) * 100}%` } as CSSProperties}
        aria-label={`${label} ${value.toFixed(2)}x`}
      />
      <output className={value === 1 ? '' : 'is-changed'}>{value.toFixed(2)}×</output>
    </label>
  );
}
