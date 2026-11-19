/**
 * generate-default-music.cjs
 * -----------------------------------------------------------------------------
 * Generates the app's bundled royalty-free slideshow tracks as 16-bit WAV files
 * in assets/music/. Everything is synthesized here (soft pads + plucked
 * arpeggios over simple chord progressions) — original audio, safe to ship.
 * Run: node _scripts/generate-default-music.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const SR = 44100;

/** Note name (e.g. 'A4') → frequency. */
function freq(note) {
  const m = /^([A-G])(#?)(\d)$/.exec(note);
  const idx = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (idx - 9) / 12 + (Number(m[3]) - 4));
}

/** Add a tone into buf: soft additive voice with attack/release envelope. */
function tone(buf, startSec, durSec, f, amp, kind) {
  const s0 = Math.floor(startSec * SR);
  const n = Math.floor(durSec * SR);
  const atk = kind === 'pluck' ? 0.008 : Math.min(0.8, durSec * 0.35);
  const rel = kind === 'pluck' ? durSec * 0.9 : Math.min(1.2, durSec * 0.45);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    let env = 1;
    if (t < atk) env = t / atk;
    else if (t > durSec - rel) env = Math.max(0, (durSec - t) / rel);
    if (kind === 'pluck') env *= Math.exp(-3 * t / durSec);
    const ph = 2 * Math.PI * f * t;
    // Soft timbre: fundamental + quiet octave + 12th, slight detune shimmer.
    const v = Math.sin(ph) + 0.35 * Math.sin(2 * ph + 0.3) + 0.12 * Math.sin(3 * ph)
      + 0.18 * Math.sin(2 * Math.PI * (f * 1.003) * t);
    const j = s0 + i;
    if (j < buf.length) buf[j] += v * env * amp;
  }
}

function renderTrack({ name, bpm, beatsPerChord, chords, arp, arpAmp, padAmp, bars }) {
  const spb = 60 / bpm;
  const chordDur = beatsPerChord * spb;
  const total = bars * chords.length * chordDur + 2;
  const buf = new Float64Array(Math.ceil(total * SR));
  for (let bar = 0; bar < bars; bar += 1) {
    chords.forEach((chord, ci) => {
      const t0 = (bar * chords.length + ci) * chordDur;
      // Pad: chord tones held for the whole chord.
      chord.forEach((nn, k) => tone(buf, t0, chordDur * 1.05, freq(nn), padAmp * (k === 0 ? 1 : 0.75), 'pad'));
      // Arpeggio: plucked pattern over the chord (octave up).
      if (arp) {
        const steps = arp.pattern;
        const stepDur = chordDur / steps.length;
        steps.forEach((deg, si) => {
          if (deg === null) return;
          const base = chord[deg % chord.length];
          const up = Math.floor(deg / chord.length);
          const f0 = freq(base) * Math.pow(2, 1 + up);
          tone(buf, t0 + si * stepDur, stepDur * 2.2, f0, arpAmp, 'pluck');
        });
      }
    });
  }
  // Gentle fade in/out at the loop boundaries + normalize.
  const fadeN = Math.floor(1.2 * SR);
  for (let i = 0; i < fadeN; i += 1) {
    buf[i] *= i / fadeN;
    buf[buf.length - 1 - i] *= i / fadeN;
  }
  let peak = 0;
  for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i]));
  const g = 0.72 / (peak || 1);
  const pcm = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(buf[i] * g * 32767)));
  return { name, pcm };
}

function writeWav(file, pcm) {
  const dataLen = pcm.length * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i += 1) b.writeInt16LE(pcm[i], 44 + i * 2);
  fs.writeFileSync(file, b);
}

const C = (...n) => n;
const tracks = [
  renderTrack({
    name: 'Gentle Waves', bpm: 60, beatsPerChord: 4, bars: 4, padAmp: 0.5, arpAmp: 0.16,
    chords: [C('C3', 'E3', 'G3'), C('G2', 'B2', 'D3'), C('A2', 'C3', 'E3'), C('F2', 'A2', 'C3')],
    arp: { pattern: [0, 2, 4, 2, 5, 2, 4, 2] },
  }),
  renderTrack({
    name: 'Warm Memories', bpm: 84, beatsPerChord: 3, bars: 5, padAmp: 0.42, arpAmp: 0.2,
    chords: [C('G2', 'B2', 'D3'), C('E2', 'G2', 'B2'), C('C3', 'E3', 'G3'), C('D3', 'F#3', 'A3')],
    arp: { pattern: [0, 4, 2, null, 4, 1] },
  }),
  renderTrack({
    name: 'Celebration', bpm: 104, beatsPerChord: 4, bars: 5, padAmp: 0.36, arpAmp: 0.24,
    chords: [C('D3', 'F#3', 'A3'), C('B2', 'D3', 'F#3'), C('G2', 'B2', 'D3'), C('A2', 'C#3', 'E3')],
    arp: { pattern: [0, 2, 4, 6, 4, 2, 0, 2, 4, 2, 5, 2, 4, 2, 1, 2] },
  }),
];

const dir = path.join(__dirname, '..', 'assets', 'music');
fs.mkdirSync(dir, { recursive: true });
for (const t of tracks) {
  const file = path.join(dir, `${t.name.replace(/\s+/g, '_')}.wav`);
  writeWav(file, t.pcm);
  console.log('wrote', file, `${Math.round(t.pcm.length / SR)}s`, `${Math.round(fs.statSync(file).size / 1024 / 1024 * 10) / 10}MB`);
}
