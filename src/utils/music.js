import { DEFAULT_SCALE } from '../constants/bloomDefaults';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFrequency(midi) {
  return 440 * (2 ** ((midi - 69) / 12));
}

export function midiToLabel(midi) {
  const safeMidi = Math.round(midi);
  const name = NOTE_NAMES[((safeMidi % 12) + 12) % 12];
  const octave = Math.floor(safeMidi / 12) - 1;
  return `${name}${octave}`;
}

export function mapYToPitch(yNorm, scale = DEFAULT_SCALE) {
  const safeY = clamp(Number(yNorm) || 0, 0, 1);
  const rootMidi = Number.isFinite(Number(scale?.rootMidi)) ? Number(scale.rootMidi) : DEFAULT_SCALE.rootMidi;
  const intervals = Array.isArray(scale?.intervals) && scale.intervals.length
    ? scale.intervals.map((interval) => Number(interval) || 0)
    : DEFAULT_SCALE.intervals;
  const octaves = Number.isFinite(Number(scale?.octaves)) ? Math.max(1, Math.round(Number(scale.octaves))) : DEFAULT_SCALE.octaves;
  const totalSteps = Math.max(1, (intervals.length * octaves) - 1);
  const stepIndex = Math.round((1 - safeY) * totalSteps);
  const octaveIndex = Math.floor(stepIndex / intervals.length);
  const degreeIndex = stepIndex % intervals.length;
  const midi = rootMidi + (octaveIndex * 12) + intervals[degreeIndex];

  return {
    midi,
    frequency: midiToFrequency(midi),
    noteLabel: midiToLabel(midi),
    stepIndex,
  };
}

export function mapXToFilter(xNorm) {
  const safeX = clamp(Number(xNorm) || 0, 0, 1);
  const curved = safeX ** 1.15;
  return Math.round(180 + (curved * 4620));
}

export function mapPressMetrics(durationMs) {
  const safeDuration = clamp(Number(durationMs) || 0, 50, 1600);
  const norm = (safeDuration - 50) / 1550;

  return {
    durationMs: safeDuration,
    lifetimeMs: Math.round(550 + (safeDuration * 2.8)),
    noteLengthMs: Math.round(140 + (safeDuration * 1.25)),
    sizeMultiplier: 0.72 + (norm * 1.45),
    attackMs: Math.round(16 + (safeDuration * 0.22)),
    releaseMs: Math.round(110 + (safeDuration * 0.72)),
    fmDepth: Number((1.4 + (norm * 6.6)).toFixed(2)),
  };
}
