// Generates an original sample beatmap archive (samples/bad-osu-demo.osz) for testing and demos.
// Everything here is synthesized by this script: the audio is a generated 120 BPM drum/tone loop,
// the background is a generated gradient PNG, and the chart is hand-authored.
// Usage: npm run sample
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';

const SR = 22050;
const BPM = 120;
const beat = 60 / BPM; // seconds
const DURATION = 34; // seconds

// ---- audio: kick on every beat, hat on off-beats, a soft pad chord every bar ----
const samples = new Float32Array(Math.ceil(SR * DURATION));
const chords = [
  [220, 277.18, 329.63],
  [196, 246.94, 293.66],
  [174.61, 220, 261.63],
  [196, 246.94, 293.66],
];
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
for (let i = 0; i < samples.length; i++) {
  const t = i / SR;
  const bar = Math.floor(t / (beat * 4)) % chords.length;
  let v = 0;
  for (const f of chords[bar]) v += Math.sin(2 * Math.PI * f * t) * 0.03;
  v *= Math.min(1, t * 2) * Math.max(0, 1 - ((t % (beat * 4)) / (beat * 4)) * 0.4);
  samples[i] += v;
}
const addKick = (t0) => {
  const start = Math.floor(t0 * SR);
  for (let n = 0; n < SR * 0.3; n++) {
    const t = n / SR;
    const f = 150 * Math.exp(-t * 18) + 40;
    samples[start + n] = (samples[start + n] ?? 0) + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 12) * 0.6;
  }
};
const addHat = (t0) => {
  const start = Math.floor(t0 * SR);
  for (let n = 0; n < SR * 0.05; n++) samples[start + n] = (samples[start + n] ?? 0) + rnd() * Math.exp(-(n / SR) * 90) * 0.15;
};
for (let k = 0; k * beat < DURATION; k++) {
  addKick(k * beat);
  addHat(k * beat + beat / 2);
}
const pcm = Buffer.alloc(samples.length * 2);
for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 0.8 * 32767))), i * 2);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + pcm.length, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);

// ---- background: generated PNG gradient ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const W = 320;
const H = 180;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const o = y * (W * 3 + 1) + 1 + x * 3;
    raw[o] = Math.round(40 + (x / W) * 90);
    raw[o + 1] = Math.round(20 + (y / H) * 40);
    raw[o + 2] = Math.round(90 + ((x + y) / (W + H)) * 110);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

// ---- chart: 120 BPM, 4/4, 1/2-beat rhythm with a slider, a spinner and a short break ----
const offset = 2000;
const objs = [];
const xy = (i) => [Math.round(256 + 170 * Math.cos(i * 0.9)), Math.round(192 + 120 * Math.sin(i * 0.9))];
let t = offset;
let newCombo = true;
for (let i = 0; i < 24; i++) {
  const [x, y] = xy(i);
  objs.push(`${x},${y},${Math.round(t)},${newCombo ? 5 : 1},0,0:0:0:0:`);
  newCombo = i % 4 === 3;
  t += beat / 2;
}
// Slider: 2 beats long, straight line to the right.
objs.push(`120,120,${Math.round(t)},6,0,L|300:120,1,140,0,0,0:0:0:0:`);
t += beat * 2 + beat / 2;
// Quick stream
for (let i = 0; i < 8; i++) {
  const x = 100 + i * 40;
  objs.push(`${x},260,${Math.round(t)},5,0,0:0:0:0:`);
  t += beat / 2;
}
// Spinner: 2 beats
objs.push(`256,192,${Math.round(t)},12,0,${Math.round(t + beat * 2)},0:0:0:0:`);
t += beat * 2 + beat / 2;
// Final circles
for (let i = 0; i < 10; i++) {
  const [x, y] = xy(i + 3);
  objs.push(`${x},${y},${Math.round(t)},${i === 0 ? 5 : 1},0,0:0:0:0:`);
  t += beat;
}

const osu = (version, cs, ar, od, hp) => `osu file format v14

[General]
AudioFilename: demo.wav
AudioLeadIn: 0
PreviewTime: 4000
Countdown: 0
SampleSet: Normal
StackLeniency: 0.7
Mode: 0

[Metadata]
Title:bad!osu Demo Tone
TitleUnicode:bad!osu Demo Tone
Artist:bad!osu sample generator
ArtistUnicode:bad!osu sample generator
Creator:bad!osu
Version:${version}
Source:
Tags:demo
BeatmapID:0
BeatmapSetID:-1

[Difficulty]
HPDrainRate:${hp}
CircleSize:${cs}
OverallDifficulty:${od}
ApproachRate:${ar}
SliderMultiplier:1.4
SliderTickRate:1

[Events]
//Background and Video events
0,0,"demo-bg.png",0,0
2,${Math.round(t - beat * 3)},${Math.round(t - beat * 2)}

[TimingPoints]
${offset},${Math.round(beat * 1000)},4,1,0,60,1,0

[HitObjects]
${objs.join('\n')}
`;

const zip = new JSZip();
zip.file('demo.wav', wav);
zip.file('demo-bg.png', png);
zip.file('bad!osu demo (Normal).osu', osu('Normal', 4, 8, 7, 6));
zip.file('bad!osu demo (Hard).osu', osu('Hard', 4.5, 9, 8, 7));
// A deliberately broken difficulty, so the import report can show invalid-file handling.
zip.file('bad!osu demo (Broken).osu', 'this is not an osu file');
const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
mkdirSync('samples', { recursive: true });
writeFileSync('samples/bad-osu-demo.osz', out);
console.log(`wrote samples/bad-osu-demo.osz (${(out.length / 1024).toFixed(0)} KB, ${objs.length} objects, ${DURATION}s audio)`);
